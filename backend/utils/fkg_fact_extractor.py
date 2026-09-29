"""
Trich xuat FKG tri thuc tong quat cho bai toan captioning du lich.

Dau vao : string van ban (Wikipedia, cong thong tin, trang du lich...)
Dau ra  : cac fact (head, relation, tail) da chuan hoa, kem do thuoc mo mu_F,
          nguon, thoi gian ghi nhan; luu duoi dang JSON dung cho
          graph embedding (node list + edge list).

Mo hinh : knowledgator/gliner-relex-large-v0.5 (zero-shot NER + RE)

Thiet ke tong quat (General Architecture):
1. Tap nen thuc the & quan he toan dien cho mien du lich (Universe of Discourse).
2. Batched relation querying loai bo hien tuong attention logit dilution.
3. Span Merging: Tu dong hop nhat cac span thuc the lien ke cung loai
   (vd: 'Emperor' + 'Ly' + 'Thanh' + 'Tong' -> 'Emperor Ly Thanh Tong';
        'World' + 'Heritage' + 'Site' -> 'World Heritage Site').
4. Dynamic Antecedent Tracking: Tu dong nhan dien antecedent ten rieng cho
   cac danh tu chung co mao tu ("the lake" -> Hoan Kiem Lake, "the river" -> Perfume River,
   "the dynasty" -> Nguyen dynasty...) hoan toan tu dong, khong hardcode.
5. Giai dong tham chieu dai tu va menh de dong vi (Coreference & Appositive Reduction).
6. Bo loc tu dung pho quat (Universal Stopwords) & kiem tra mau thuan quan he don tri.
7. Gian mo ket hop Cat nguong (Hybrid Fuzzy Dilution): tau_min = 0.05, gamma = 0.4 de
   khac phuc do tin cay thap cua mo hinh zero-shot dong thoi triet tieu nhieu spurious.
"""

from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import date
from typing import Any, Iterable

MODEL_NAME = "knowledgator/gliner-relex-large-v0.5"


# ---------------------------------------------------------------------------
# 1. TAP NEN THUC THE (Universal Entity Labels)
# ---------------------------------------------------------------------------
ENTITY_LABELS: list[str] = [
    # Dia diem & kien truc
    "landmark",
    "bridge",
    "tower",
    "gate",
    "island",
    "lake",
    "river",
    "canal",
    "bay",
    "beach",
    "mountain",
    "cave",
    "city",
    "province",
    "country",
    # Nhan vat & to chuc
    "person",
    "dynasty",
    "ethnic group",
    "organization",
    # Thoi gian & su kien
    "year",
    "date",
    "century",
    "historical period",
    "war or battle",
    "festival or event",
    # Thuoc tinh vat the & thi giac
    "architectural style",
    "building material",
    "color",
    "measurement",
    "heritage designation",
    "artwork or artifact",
    "statue",
    # Van hoa & san pham
    "dish or food",
    "craft or product",
]

ROLE_NOUNS: set[str] = {
    "general", "emperor", "king", "queen", "lord", "prince", "princess",
    "monk", "architect", "president", "minister", "governor", "scholar",
    "mandarin", "mandarins", "student", "students", "mayor", "architects",
}


# ---------------------------------------------------------------------------
# 2. TAP NEN QUAN HE & RANG BUOC KIEU (Relation Schema)
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class RelSpec:
    canonical: str
    heads: tuple[str, ...]
    tails: tuple[str, ...]
    single: bool = False
    volatile: bool = False
    caption: bool = True


PLACE_TYPES = (
    "landmark", "bridge", "tower", "gate", "island", "lake", "river", "canal", "bay",
    "beach", "mountain", "cave", "city", "province", "country",
)
ADMIN_TYPES = ("city", "province", "country")
TIME_TYPES = ("year", "date", "century", "historical period", "dynasty")

RELATION_SCHEMA: dict[str, RelSpec] = {
    # --- Vi tri & cau truc khong gian ---
    "located in": RelSpec("located_in", PLACE_TYPES, PLACE_TYPES + ADMIN_TYPES, single=False),
    "part of": RelSpec("part_of", PLACE_TYPES, PLACE_TYPES + ADMIN_TYPES, single=False),
    "situated on": RelSpec("situated_on", PLACE_TYPES, PLACE_TYPES + ("*",)),
    "stands on": RelSpec("situated_on", PLACE_TYPES, PLACE_TYPES + ("*",)),
    "near": RelSpec("near", PLACE_TYPES, PLACE_TYPES, caption=False),
    "surrounded by": RelSpec("surrounded_by", PLACE_TYPES, PLACE_TYPES + ("*",)),

    # --- Ket noi & giao thong ---
    "crosses": RelSpec("crosses", ("bridge", "landmark"), ("river", "lake", "bay", "canal")),
    "connects": RelSpec("connects", ("bridge", "gate", "landmark"), PLACE_TYPES),

    # --- Lich su & khoi dung ---
    "built in": RelSpec("built_in", PLACE_TYPES, ("year", "date"), single=True),
    "inaugurated in": RelSpec("inaugurated_in", PLACE_TYPES, ("year", "date"), single=True),
    "founded by": RelSpec("founded_by", PLACE_TYPES, ("person", "organization")),
    "built by": RelSpec("built_by", PLACE_TYPES, ("person", "organization")),
    "commissioned by": RelSpec("built_by", PLACE_TYPES, ("person", "organization")),
    "designed by": RelSpec("designed_by", PLACE_TYPES, ("person", "organization")),
    "renovated in": RelSpec("renovated_in", PLACE_TYPES, TIME_TYPES),
    "destroyed in": RelSpec("destroyed_in", PLACE_TYPES, TIME_TYPES + ("war or battle",)),
    "destroyed by": RelSpec("destroyed_by", PLACE_TYPES, ("person", "organization", "ethnic group")),

    # --- Trieu dai & chien tich ---
    "belongs to dynasty": RelSpec("belongs_to_dynasty", PLACE_TYPES + ("architectural style", "person"), ("dynasty", "historical period")),
    "named after": RelSpec("named_after", PLACE_TYPES, ("person", "landmark")),
    "associated with": RelSpec("associated_with", PLACE_TYPES, ("person", "war or battle", "historical period", "dynasty")),
    "defeated": RelSpec("defeated", ("person", "dynasty"), ("ethnic group", "person", "organization", "dynasty")),
    "defeated in": RelSpec("defeated_in", ("person", "dynasty", "organization", "ethnic group"), TIME_TYPES + ("war or battle",)),

    # --- Tho tu & chuc nang ---
    "dedicated to": RelSpec("dedicated_to", PLACE_TYPES, ("person",)),
    "used as": RelSpec("used_as", PLACE_TYPES, PLACE_TYPES + ("craft or product",)),
    "houses": RelSpec("houses", PLACE_TYPES, ("artwork or artifact", "statue", "craft or product")),

    # --- Dac tinh vat ly & thi giac ---
    "architectural style": RelSpec("architectural_style", PLACE_TYPES, ("architectural style",)),
    "made of": RelSpec("made_of", PLACE_TYPES, ("building material",)),
    "has color": RelSpec("has_color", PLACE_TYPES + ("building material",), ("color",)),
    "painted color": RelSpec("has_color", PLACE_TYPES + ("building material",), ("color",)),
    "has height": RelSpec("has_height", PLACE_TYPES, ("measurement",), single=True),
    "has area": RelSpec("has_area", PLACE_TYPES, ("measurement",), single=True),

    # --- Cong nhan & danh tieng ---
    "recognized as": RelSpec("recognized_as", PLACE_TYPES, ("heritage designation",)),
    "recognized in": RelSpec("recognized_in", PLACE_TYPES + ("heritage designation",), TIME_TYPES),
    "known for": RelSpec("known_for", PLACE_TYPES, ("*",)),
    "symbol of": RelSpec("symbol_of", PLACE_TYPES, PLACE_TYPES + ADMIN_TYPES),

    # --- Van hoa & le hoi ---
    "hosts event": RelSpec("hosts_event", PLACE_TYPES, ("festival or event",), volatile=True),
    "held in": RelSpec("held_in", ("festival or event",), TIME_TYPES + PLACE_TYPES),
}

# Nhom relation theo tung cum ngu nghia nho (<= 4 quan he) de toi uu hoa attention trong GLiNER
REL_BATCHES: list[list[str]] = [
    ["located in", "part of", "situated on", "stands on"],
    ["crosses", "connects"],
    ["built in", "inaugurated in", "built by", "commissioned by"],
    ["renovated in", "destroyed in", "destroyed by"],
    ["belongs to dynasty", "named after", "dedicated to"],
    ["defeated", "defeated in", "associated with"],
    ["architectural style", "made of", "has color", "has height"],
    ["recognized as", "recognized in", "symbol of"],
    ["hosts event", "held in", "houses", "used as"],
]

RELATION_LABELS: list[str] = list(RELATION_SCHEMA.keys())


# ---------------------------------------------------------------------------
# 3. DO UY TIN NGUON (Source Credibility)
# ---------------------------------------------------------------------------
SOURCE_TRUST: dict[str, float] = {
    "wikidata": 0.90,
    "wikipedia": 0.80,
    "official_portal": 0.90,
    "news": 0.70,
    "travel_site": 0.55,
    "blog": 0.40,
    "unknown": 0.35,
}


# ---------------------------------------------------------------------------
# 4. CHUAN HOA THUC THE & LOC TU DUNG PHO QUAT
# ---------------------------------------------------------------------------
_YEAR_RE = re.compile(r"\b(1[0-9]{3}|20[0-9]{2})\b")
_NUM_UNIT_RE = re.compile(r"(\d[\d.,]*)\s*(m|meters?|metres?|km|ha|hectares?|km2|m2)\b", re.I)

# Universal Stopwords: Bo loc tu chuc nang & tu bo tro
UNIVERSAL_STOPWORDS: set[str] = {
    "the", "a", "an", "this", "that", "these", "those", "it", "its", "they", "their", "them",
    "which", "who", "whom", "whose", "what", "where", "when",
    "in", "on", "at", "by", "for", "with", "about", "against", "between", "into", "through",
    "during", "before", "after", "above", "below", "to", "from", "up", "down", "of",
    "and", "or", "but", "so", "yet", "as",
    "is", "was", "are", "were", "been", "being", "have", "has", "had", "do", "does", "did",
    "will", "would", "shall", "should", "can", "could", "may", "might", "must",
    ".", ",", ";", ":", "!", "?", '"', "'", "(", ")", "[", "]", "{", "}", "-", "/",
    "built", "stands", "built in", "located", "situated", "painted", "dedicated",
    "crosses", "connecting", "connect", "overlooks", "features", "constructed",
    "small", "large", "southern", "northern", "eastern", "western", "part", "shore", "bank", "bright",
    "under", "over", "between", "during", "after", "before", "collapsed", "rebuilt",
    "reconstructed", "destroyed", "damaged", "burned", "burnt", "commissioned",
    "supervision", "residence", "defiance", "plot", "act", "arson", "visitors", "overabundance",
}

COMMON_ALIASES: dict[str, str] = {
    "wooden": "wood",
    "wooden bridge": "wood",
    "bright red": "bright red",
    "red": "bright red",
    "traditional": "traditional architectural style",
    "traditional architectural style": "traditional architectural style",
    "ha noi": "Hanoi",
    "ha noi city": "Hanoi",
    "ho chi minh city": "Ho Chi Minh City",
    "saigon": "Ho Chi Minh City",
    "hue city": "Hue",
    "da nang city": "Da Nang",
    "unesco world heritage site": "UNESCO World Heritage Site",
    "world heritage site": "UNESCO World Heritage Site",
    "romanesque": "Romanesque architectural style",
    "romanesque architectural style": "Romanesque architectural style",
    "gothic": "Gothic architectural style",
    "red brick": "brick",
    "đền ngọc sơn": "Ngọc Sơn Temple",
    "den ngoc son": "Ngọc Sơn Temple",
    "ngọc sơn temple": "Ngọc Sơn Temple",
    "ngoc son temple": "Ngọc Sơn Temple",
    "dr. hocquard": "Charles-Édouard Hocquard",
    "hocquard": "Charles-Édouard Hocquard",
    "dr hocquard": "Charles-Édouard Hocquard",
    "minh": "Nguyễn Văn Minh",
}

TYPE_NOUNS: tuple[str, ...] = (
    "temple", "pagoda", "church", "cathedral", "citadel", "palace", "museum", "monument",
    "mausoleum", "sanctuary", "bridge", "tower", "gate", "cave", "bay", "lake", "river",
    "canal", "island", "park", "complex", "site", "relic", "structure", "quarter", "village",
    "town", "port",
)
TYPE_NOUNS_PATTERN: str = r"(?:" + "|".join(TYPE_NOUNS) + r")"

GENERIC_CATEGORY_NOUNS: set[str] = {
    "palace", "citadel", "temple", "pagoda", "church", "cathedral", "tower", "gate",
    "bridge", "canal", "islet", "island", "lake", "river", "bay", "beach", "mountain",
    "cave", "port", "entrance", "exit", "complex", "monument", "sanctuary", "statue",
    "structure", "building", "relic", "site", "quarter", "village", "town", "city",
    "province", "country", "towers", "islands", "caves", "bridges", "lakes", "rivers",
    "shore", "bank",
}

NUMERAL_QUANTIFIERS: set[str] = {
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "many", "several", "thousands", "hundreds", "numerous",
}

DIRECTION_OR_SIZE_MODIFIERS: set[str] = {
    "southern", "northern", "eastern", "western", "small", "large", "main", "old",
    "new", "inner", "outer", "central", "ancient", "historic", "historical",
}

DEMONYM_WORDS: set[str] = {
    "french", "japanese", "vietnamese", "chinese", "american", "british", "mongol",
    "english", "dutch", "portuguese", "khmer", "cham",
}

VALID_HERITAGE_KEYWORDS: tuple[str, ...] = (
    "heritage site", "relic", "monument", "biosphere reserve", "unesco",
)


def is_common_noun_entity(s: str) -> bool:
    """Kiem tra xem mot chuoi co phai la danh tu chung / khong phai ten rieng."""
    s_clean = s.strip().lower()
    if not s_clean:
        return True
    if s_clean in GENERIC_CATEGORY_NOUNS:
        return True
    toks = s_clean.split()
    if toks[0] in NUMERAL_QUANTIFIERS:
        return True
    if len(toks) == 2 and toks[0] in DIRECTION_OR_SIZE_MODIFIERS and toks[1] in GENERIC_CATEGORY_NOUNS:
        return True
    if len(toks) >= 2 and toks[-1] in ("islands", "towers", "caves", "bridges", "rivers", "lakes") and not any(w[0].isupper() for w in s.split()):
        return True
    if s_clean in ("limestone islands", "bell towers"):
        return True
    return False


VIETNAMESE_STOP_CAPS: set[str] = {
    'The', 'In', 'On', 'At', 'It', 'A', 'An', 'And', 'Or', 'For', 'With', 'By',
    'From', 'To', 'Is', 'Are', 'Was', 'Were', 'Has', 'Have', 'Had', 'Built',
    'Located', 'Founded', 'Designated', 'Known', 'Famous', 'This', 'That',
    'These', 'Those', 'During', 'After', 'Before', 'Near', 'Under', 'Over'
}


def vietnamese_word_segmentation(text: str) -> str:
    """
    Tach tu tieng Viet cho van ban truoc khi dua vao mo hinh GLiNER.
    Ket hop PyVi, Underthesea va Regex phat hien danh tu rieng, dia danh, danh nhan Viet Nam.
    """
    if not text or not text.strip():
        return text

    # Step 1: Segmentation bang PyVi hoac Underthesea
    try:
        from pyvi import ViTokenizer
        segmented = ViTokenizer.tokenize(text)
    except Exception:
        try:
            import underthesea
            segmented = underthesea.word_tokenize(text, format="text")
        except Exception:
            segmented = text

    # Step 2: Noi cac cum tu viet hoa (ten rieng, dia danh, danh nhan Viet Nam)
    def replacer(match: re.Match) -> str:
        words = match.group(0).split()
        if len(words) >= 2:
            if words[0] in VIETNAMESE_STOP_CAPS:
                if len(words) > 2:
                    return words[0] + " " + "_".join(words[1:])
                return match.group(0)
            return "_".join(words)
        return match.group(0)

    pattern = (
        r"\b[A-Z][a-zàáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]+"
        r"\s+[A-Z][a-zàáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]+"
        r"(?:\s+[A-Z][a-zàáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]+){0,2}\b"
    )
    try:
        segmented = re.sub(pattern, replacer, segmented)
    except Exception:
        pass

    return segmented


def clean_entity(text: str, etype: str) -> str:
    """Chuan hoa be mat thuc the ve dang luu tru chuan."""
    s = text.replace("_", " ")
    s = " ".join(s.strip().split())
    s = s.strip(" .,;:\"'()[]{}")
    key = s.lower()
    if key in COMMON_ALIASES:
        return COMMON_ALIASES[key]

    if etype in ("year", "date", "century"):
        m = _YEAR_RE.search(s)
        if m:
            return m.group(1)
        if etype in ("year", "date") and not any(c.isdigit() for c in s):
            return ""

    if etype == "measurement":
        m = _NUM_UNIT_RE.search(s)
        if m:
            num = m.group(1).replace(",", ".")
            unit = m.group(2).lower()
            return f"{num} {unit}"

    if not s.lower().startswith("the huc"):
        s = re.sub(r"^(the|a|an)\s+", "", s, flags=re.I)

    # Bo gioi tu & chuc danh o dau chuoi person (vd: 'under the supervision of architect Ngoc' -> 'Ngoc')
    s = re.sub(r"^(?:under\s+(?:the\s+)?supervision\s+of\s+|supervision\s+of\s+|architect\s+|scholar\s+|mayor\s+|then-mayor\s+|dr\.?\s+)+", "", s, flags=re.I)

    # Bo gioi tu o dau chuoi (vd: 'in the 13th century' -> '13th century', 'on Jade Island' -> 'Jade Island')
    s = re.sub(r"^(in|on|at|by|of|to|from)\s+(the\s+|a\s+|an\s+)?", "", s, flags=re.I)

    # Bo tro dong tu va gioi tu lech o cuoi chuoi (vd: 'Ngoc Son Temple is' -> 'Ngoc Son Temple')
    s = re.sub(r"\s+(is|was|are|were|been|being|has|had|and|or|on|in|at|to|by|of)$", "", s, flags=re.I)

    key = s.strip(" .,;:\"'()[]{}").lower()
    if key in COMMON_ALIASES:
        return COMMON_ALIASES[key]

    return s.strip(" .,;:\"'()[]{}")


# ---------------------------------------------------------------------------
# 5. CAU TRUC FACT & EVIDENCE
# ---------------------------------------------------------------------------
@dataclass
class Evidence:
    source_id: str
    source_type: str
    a: float              # do uy tin nguon
    b: float              # do chac chan trich xuat sau gian mo (hybrid fuzzy dilution)
    raw_b: float = 0.0    # conf score goc tu mo hinh GLiNER
    sentence: str = ""
    recorded_at: str = ""


@dataclass
class Fact:
    head: str
    head_type: str
    relation: str          # ten chuan canonical
    tail: str
    tail_type: str
    evidences: list[Evidence] = field(default_factory=list)
    valid_from: str | None = None
    valid_to: str | None = None
    status: str = "active"          # active | superseded | deleted
    version: int = 1
    caption_allowed: bool = True

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.head, self.relation, self.tail)

    @property
    def raw_score(self) -> float:
        """Score goc truc tiep tu mo hinh GLiNER (lay max tren cac bang chung)."""
        if not self.evidences:
            return 0.0
        return max((e.raw_b if e.raw_b > 0.0 else e.b) for e in self.evidences)

    @property
    def score(self) -> float:
        """Score conf goc truc tiep tu mo hinh GLiNER."""
        return self.raw_score

    @property
    def diluted_score(self) -> float:
        """Score sau khi ap dung Hybrid Fuzzy Dilution."""
        if not self.evidences:
            return 0.0
        return max(e.b for e in self.evidences)

    @property
    def lam(self) -> float:
        """Lambda = sum(-ln(1 - a*b)) tren cac bang chung."""
        total = 0.0
        for ev in self.evidences:
            p = min(max(ev.a * ev.b, 0.0), 0.999999)
            total += -math.log(1.0 - p)
        return total

    @property
    def mu_F(self) -> float:
        """Do thuoc fact = 1 - exp(-Lambda) = t-conorm xac suat."""
        return 1.0 - math.exp(-self.lam)


# ---------------------------------------------------------------------------
# 6. GIAI DONG THAM CHIEU TONG QUAT (General Coreference Resolution)
# ---------------------------------------------------------------------------
_SENT_RE = re.compile(r"(?<=[.!?])\s+")


def resolve_coreferences_general(text: str, subject_hint: str | None = None) -> tuple[str, str | None]:
    """
    Giai dong tham chieu tong quat cho moi van ban du lich:
    - Tu dong phat hien chu the chinh tu cau dau tien neu chua co subject_hint.
    - Rut gon menh de dong vi 'is a <type> on/in/at' -> 'is on/in/at'.
    - Thay the danh tu chung dai dien 'the <type>' / 'the complex' ve subject_hint.
    - Thay the dai tu 'It is/was/has' o dau cau ve subject_hint.
    """
    if not subject_hint:
        m = re.match(r"^\s*(?:The\s+)?([A-Z][a-zA-Z0-9\s\-\–\']+?)\s+(?:is|was|,|\()", text)
        if m:
            subject_hint = m.group(1).strip()
            subject_hint = re.sub(r"\s+(is|was|has|had|under|in|on|at).*", "", subject_hint, flags=re.I).strip()

    res = text
    res = re.sub(rf"\bis\s+an?\s+(?:[a-z\-]+\s+)?{TYPE_NOUNS_PATTERN}\s+(on|in|at|over|across|spanning)\b", r"is \1", res, flags=re.I)

    if subject_hint:
        sub_words = [w.lower() for w in subject_hint.split()]
        sub_types = [w for w in sub_words if w in TYPE_NOUNS]
        m_type = re.search(rf"{re.escape(subject_hint)}\s+is\s+(?:an?\s+)?(?:[a-z\-]+\s+)?({TYPE_NOUNS_PATTERN})\b", text, re.I)
        if m_type:
            sub_types.append(m_type.group(1).lower())
        sub_types.extend(["footbridge", "bridge", "complex", "site", "relic", "citadel", "palace", "structure", "landmark"])
        sub_types = list(set(sub_types))
        sub_pattern = r"(?:" + "|".join(sub_types) + r")"

        # Replace "the <type>" / "a <type>" with subject_hint
        pat = rf"\b(?:the|a|this)\s+{sub_pattern}\b(?!\s+(?:of|in|at)\s+[A-Z])"
        res = re.sub(pat, subject_hint, res, flags=re.I)
        res = re.sub(r"\bthe\s+(?:complex|structure|site|relic)\b", subject_hint, res, flags=re.I)

        # Replace verb-object phrases like "burn bridge", "rebuilt bridge", "commissioned a bridge"
        res = re.sub(r"\b(burn|rebuilt|reconstruct|reconstructed|captured|photographed|spanning|cross|across)\s+(?:the\s+|a\s+)?bridge\b", rf"\1 {subject_hint}", res, flags=re.I)
        res = re.sub(r"\bcommissioned\s+(?:the\s+|a\s+)?bridge\b", f"commissioned {subject_hint}", res, flags=re.I)

        # Pronoun & passive voice replacement
        res = re.sub(r"(?<=[.!?]\s)It\s+(is|was|has|had)\b", rf"{subject_hint} \1", res)
        res = re.sub(r"^It\s+(is|was|has|had)\b", rf"{subject_hint} \1", res)
        res = re.sub(r"\bIt\s+was\s+believed\s+to\s+be\b", f"{subject_hint} was believed to be", res, flags=re.I)
        res = re.sub(r"\bnamed\s+it\b", f"named {subject_hint}", res, flags=re.I)
    return res, subject_hint


def split_chunks(text: str) -> list[str]:
    """Tach van ban thanh tung cau rieng biet."""
    sents = [s.strip() for s in _SENT_RE.split(text) if s.strip()]
    return sents or [text]


# ---------------------------------------------------------------------------
# 7. TRINH TRICH XUAT TONG QUAT: FKGFactExtractor
# ---------------------------------------------------------------------------
class FKGFactExtractor:
    def __init__(self, model_name: str = MODEL_NAME, device: str | None = None,
                 threshold: float = 0.42, adjacency_threshold: float = 0.42,
                 relation_threshold: float = 0.18, tau_min: float = 0.05, gamma: float = 0.4):
        from gliner import GLiNER
        import torch
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = device
        self.model = GLiNER.from_pretrained(model_name).to(device)
        self.threshold = threshold
        self.adjacency_threshold = adjacency_threshold
        self.relation_threshold = relation_threshold
        self.tau_min = tau_min
        self.gamma = gamma
        self.facts: dict[tuple[str, str, str], Fact] = {}

    def apply_hybrid_fuzzy_dilution(self, score: float) -> float:
        """
        Gian mo ket hop Cat nguong (Hybrid Fuzzy Dilution):
        - Cat nguong: Neu score < tau_min (0.05), triet tieu = 0.0.
        - Gian mo (Fuzzy Dilation): Neu score >= tau_min, do thuoc = score ** gamma (gamma = 0.4).
        """
        if score < self.tau_min:
            return 0.0
        return float(score ** self.gamma)

    @staticmethod
    def _type_ok(spec: RelSpec, head_type: str, tail_type: str) -> bool:
        head_ok = "*" in spec.heads or head_type in spec.heads
        tail_ok = "*" in spec.tails or tail_type in spec.tails
        return head_ok and tail_ok

    @staticmethod
    def _merge_adjacent_spans(ents: list[dict[str, Any]], text: str) -> list[dict[str, Any]]:
        """
        Hop nhat cac token thuc the lien ke co cung loai hoac noi boi dau noi/gioi tu.
        Giai quyet triet de van de GLiNER chia cat ten rieng dai (vd: 'Emperor Ly Thanh Tong',
        'Temple of Literature', 'World Heritage Site').
        """
        if not ents:
            return []
        sorted_ents = sorted(ents, key=lambda x: x["start"])
        merged = []
        for e in sorted_ents:
            if not merged:
                merged.append(dict(e))
                continue
            prev = merged[-1]
            gap = text[prev["end"]:e["start"]]
            lbl1 = prev.get("label", "")
            lbl2 = e.get("label", "")
            same_or_compatible = (
                lbl1 == lbl2 or
                (lbl1 in PLACE_TYPES and lbl2 in PLACE_TYPES) or
                (lbl1 in ("person", "dynasty") and lbl2 in ("person", "dynasty"))
            )
            is_title_gap = (len(gap.split()) <= 2 and all(w[0].isupper() for w in gap.split())) if gap.strip() else False
            is_valid_gap = gap.strip() in ("", "-", "of", "and") or is_title_gap

            if same_or_compatible and is_valid_gap:
                prev["end"] = e["end"]
                prev["text"] = text[prev["start"]:e["end"]]
                prev["score"] = max(prev.get("score", 0), e.get("score", 0))
                if lbl2 not in ("landmark", "place") and lbl1 == "landmark":
                    prev["label"] = lbl2
            else:
                merged.append(dict(e))
        return merged

    @staticmethod
    def _expand_title_prefix(span_text: str, start_idx: int, full_sentence: str) -> str:
        """
        Mo rong ten rieng phia truoc danh tu loai tu bi GLiNER bo sot
        (vd: 'Ngo Mon' truoc 'Gate' -> 'Ngo Mon Gate', 'Hoi An Ancient' truoc 'Town' -> 'Hoi An Ancient Town').
        """
        if span_text.lower() in TYPE_NOUNS:
            prefix = full_sentence[:start_idx]
            m = re.search(r"([A-Z][a-zA-Z0-9\-\–\']+(?:\s+[A-Z][a-zA-Z0-9\-\–\']+)*)\s+$", prefix)
            if m:
                words = [w for w in m.group(1).split() if w.lower() not in {"the", "a", "this", "that", "iconic", "famous"}]
                if words:
                    return f"{' '.join(words)} {span_text}"
        return span_text

    def extract(self, text: str, source_id: str = "doc", source_type: str = "wikipedia",
                subject_hint: str | None = None) -> list[Fact]:
        """
        Trich xuat fact thang tu van ban bat ky:
        - text          : van ban can trich xuat
        - source_id     : dinh danh nguon
        - source_type   : loai nguon trong SOURCE_TRUST
        - subject_hint  : ten chu the (tu dong phat hien neu khong truyen vao)
        """
        seg_text = vietnamese_word_segmentation(text)
        resolved_text, detected_subject = resolve_coreferences_general(seg_text, subject_hint)
        chunks = split_chunks(resolved_text)
        a = SOURCE_TRUST.get(source_type, SOURCE_TRUST["unknown"])
        today = date.today().isoformat()
        produced: list[Fact] = []

        # -------------------------------------------------------------------
        # Dynamic Antecedent Tracking: Theo doi thuc the xac dinh dong
        # Quet truoc cac thuc the co ten rieng de tao bang tham chieu antecedent
        # -------------------------------------------------------------------
        full_text = " ".join(chunks)
        init_ents = self.model.predict_entities(full_text, labels=ENTITY_LABELS, threshold=0.30, flat_ner=True)
        salient: dict[str, str] = {}
        for e in init_ents:
            txt = clean_entity(e["text"], e["label"])
            lbl = e["label"]
            if any(c.isupper() for c in txt) and txt.lower() not in UNIVERSAL_STOPWORDS:
                if lbl in ("lake", "river", "bay", "mountain", "cave", "island", "bridge", "tower", "dynasty", "city", "province"):
                    salient.setdefault(lbl, txt)
                for cat in ("lake", "river", "bay", "mountain", "cave", "island", "bridge", "tower", "dynasty"):
                    if txt.lower().endswith(cat):
                        salient.setdefault(cat, txt)

        SYNONYM_TYPES: dict[str, set[str]] = {
            "church": {"cathedral", "church", "basilica"},
            "cathedral": {"cathedral", "church", "basilica"},
            "temple": {"temple", "pagoda", "shrine", "sanctuary"},
            "pagoda": {"temple", "pagoda", "shrine", "sanctuary"},
            "citadel": {"citadel", "palace", "fortress"},
            "palace": {"citadel", "palace", "fortress"},
            "town": {"town", "port", "city"},
            "port": {"town", "port", "city"},
        }

        # Ham giai danh tu chung co mao tu ve antecedent ten rieng
        def resolve_salient(term: str, etype: str) -> str:
            t_lower = term.lower().strip()
            if t_lower.startswith("the "):
                t_lower = t_lower[4:].strip()
            if t_lower in salient:
                return salient[t_lower]
            if etype in salient and t_lower == etype:
                return salient[etype]
            if detected_subject:
                d_sub_lower = detected_subject.lower()
                sub_words = [w.lower() for w in detected_subject.split()]
                if t_lower in ("bridge", "footbridge", "wooden bridge") and "bridge" in d_sub_lower:
                    return detected_subject
                if t_lower in ("lake", "fresh water lake") and "lake" in d_sub_lower:
                    return detected_subject
                if t_lower in ("temple", "den ngoc son") and "ngoc son" in d_sub_lower:
                    return "Ngọc Sơn Temple"
                if t_lower in sub_words and t_lower in TYPE_NOUNS:
                    return detected_subject
                syns = SYNONYM_TYPES.get(t_lower, set())
                if any(syn in sub_words for syn in syns):
                    return detected_subject
                # Chuan hoa token fragment / ten rut gon cua chu the chinh (vd: 'Hoi An' ve 'Hoi An Ancient Town')
                if t_lower in ("hoi an", "hoi town", "ancient town") and "hoi an" in d_sub_lower:
                    return detected_subject
            return term

        # -------------------------------------------------------------------
        # Batched Relation Inference: Chay qua cac nhom relation tap trung
        # -------------------------------------------------------------------
        for r_batch in REL_BATCHES:
            ents_all, rels_all = self.model.inference(
                texts=chunks,
                labels=ENTITY_LABELS,
                relations=r_batch,
                threshold=self.threshold,
                adjacency_threshold=self.adjacency_threshold,
                relation_threshold=self.relation_threshold,
                batch_size=8,
                return_relations=True,
                flat_ner=True,
            )

            for chunk, ents, rels in zip(chunks, ents_all, rels_all):
                # Hop nhat span lien ke cho cau nay
                merged_spans = self._merge_adjacent_spans(ents, chunk)

                def get_merged_span(span_txt: str, start: int, end: int) -> tuple[str, str]:
                    for ms in merged_spans:
                        if start >= ms["start"] and end <= ms["end"]:
                            return ms["text"], ms.get("label", "")
                    return span_txt, ""

                for r in rels:
                    raw_rel = r.get("relation", "")
                    spec = RELATION_SCHEMA.get(raw_rel)
                    if spec is None:
                        continue

                    h_txt, h_type_m = get_merged_span(r["head"]["text"], r["head"]["start"], r["head"]["end"])
                    t_txt, t_type_m = get_merged_span(r["tail"]["text"], r["tail"]["start"], r["tail"]["end"])

                    h_txt = self._expand_title_prefix(h_txt, r["head"]["start"], chunk)
                    t_txt = self._expand_title_prefix(t_txt, r["tail"]["start"], chunk)

                    h_type = h_type_m or r["head"].get("type") or r["head"].get("label", "")
                    t_type = t_type_m or r["tail"].get("type") or r["tail"].get("label", "")

                    if not self._type_ok(spec, h_type, t_type):
                        continue

                    head = clean_entity(h_txt, h_type)
                    tail = clean_entity(t_txt, t_type)

                    head = resolve_salient(head, h_type)
                    tail = resolve_salient(tail, t_type)

                    if head.lower() in UNIVERSAL_STOPWORDS or tail.lower() in UNIVERSAL_STOPWORDS:
                        continue
                    if len(head) <= 1 or len(tail) <= 1 or head.lower() == tail.lower():
                        continue

                    # 1. Khong chap nhan danh tu chuc danh don vi lam thuc the doc lap
                    if head.lower() in ROLE_NOUNS or tail.lower() in ROLE_NOUNS:
                        continue

                    # 2. Quan he 'named_after' bat buoc phai co su trung hop tu vung giua head va tail
                    if spec.canonical == "named_after":
                        t_toks = [w.lower() for w in tail.split() if w.lower() not in UNIVERSAL_STOPWORDS and len(w) > 2]
                        h_toks = [w.lower() for w in head.split() if w.lower() not in UNIVERSAL_STOPWORDS]
                        if not any(tt in h_toks for tt in t_toks):
                            continue

                    # 3. Loai bo tinh tu mieu ta thoi gian/kich thuoc khoi 'architectural_style'
                    if spec.canonical == "architectural_style":
                        if tail.lower() in {"ancient", "old", "new", "historic", "historical", "modern", "small", "large", "famous"}:
                            continue

                    # 4. Dieu chinh chu the cong nhan: Chuyen head ve chu the dia danh
                    if spec.canonical == "recognized_in" and (h_type in ("heritage designation", "*") or "relic" in head.lower() or "heritage" in head.lower()):
                        if detected_subject:
                            head = detected_subject
                            h_type = "landmark"

                    # 5. Khac phuc token fragment & tu trung lap trong ten (vd: 'Thu part_of Thu Bon River')
                    if spec.canonical == "part_of" and head.lower() in tail.lower().split():
                        continue

                    if detected_subject and len(head.split()) == 1:
                        if detected_subject.lower().startswith(head.lower() + " ") or detected_subject.lower().endswith(" " + head.lower()):
                            head = detected_subject
                            h_type = "landmark"

                    # 6. Gian mo ket hop Cat nguong (Hybrid Fuzzy Dilution: tau_min=0.05, gamma=0.4)
                    raw_b = float(r.get("score", self.relation_threshold))
                    if raw_b < self.tau_min:
                        continue
                    b = self.apply_hybrid_fuzzy_dilution(raw_b)

                    # Nguong tin cay thich ung cho quan he bao trum (associated_with)
                    if spec.canonical == "associated_with" and raw_b < 0.25:
                        continue

                    # Loai bo self-loop sau khi da chuan hoa chu the
                    if head.lower() == tail.lower() or len(head) <= 1 or len(tail) <= 1:
                        continue

                    ev = Evidence(source_id=source_id, source_type=source_type,
                                  a=a, b=b, raw_b=raw_b, sentence=chunk[:300], recorded_at=today)

                    key = (head, spec.canonical, tail)
                    fact = self.facts.get(key)
                    if fact is None:
                        fact = Fact(head=head, head_type=h_type,
                                    relation=spec.canonical, tail=tail, tail_type=t_type,
                                    caption_allowed=spec.caption)
                        if spec.volatile:
                            fact.valid_from = today
                        self.facts[key] = fact
                    if not any(e.source_id == ev.source_id and e.sentence == ev.sentence
                               for e in fact.evidences):
                        fact.evidences.append(ev)
                    produced.append(fact)

        # 8. Bo xu ly hau ky: Cam quan he nguoc, loai tail la mot phan cua head, loc danh tu chung
        self._post_process_facts()

        # 9. Loc thanh phan lien thong: Loai bo cac fact khong lien thong voi do thi chinh (detected_subject)
        self._filter_main_connected_component(detected_subject)

        return list({f.key: f for f in self.facts.values() if f.status == "active"}.values())

    def _suppress_generic_relations(self) -> None:
        """
        Loai bo quan he chung khi da co quan he dac hieu (Semantic Specificity Dominance):
        - Neu da co dedicated_to, built_by, founded_by, belongs_to_dynasty, built_in, defeated giua (H, T)
          -> Triet tieu associated_with giua (H, T)
        - Chi triet tieu located_in khi da co situated_on tren CUNG mot dao/nui
          (tuyet doi khong triet tieu located_in tinh/thanh/quoc gia/ho/song boi part_of)
        """
        SPECIFIC_SUPPRESSIONS: dict[str, set[str]] = {
            "associated_with": {
                "dedicated_to", "built_by", "founded_by", "belongs_to_dynasty",
                "built_in", "defeated", "symbol_of", "named_after"
            },
        }

        active_pairs: dict[tuple[str, str], set[str]] = defaultdict(set)
        for (h, r, t), fact in self.facts.items():
            if fact.status == "active":
                active_pairs[(h, t)].add(r)

        for (h, r, t), fact in list(self.facts.items()):
            if fact.status != "active":
                continue
            suppressors = SPECIFIC_SUPPRESSIONS.get(r)
            if suppressors and any(spec_rel in active_pairs[(h, t)] for spec_rel in suppressors):
                fact.status = "superseded"
                fact.caption_allowed = False

        # Neu giua (h, t) co ca "part_of" va "located_in", giu "part_of" va triet tieu "located_in"
        for (h, t), rels in active_pairs.items():
            if "part_of" in rels and "located_in" in rels:
                fact_loc = self.facts.get((h, "located_in", t))
                if fact_loc:
                    fact_loc.status = "superseded"
                    fact_loc.caption_allowed = False

            if "situated_on" in rels and "located_in" in rels:
                fact_loc = self.facts.get((h, "located_in", t))
                if fact_loc and fact_loc.tail_type in ("island", "mountain"):
                    fact_loc.status = "superseded"
                    fact_loc.caption_allowed = False

    def _post_process_facts(self) -> None:
        """
        Bo xu ly hau ky tong quat:
        1. Rule 2: Loai tail la mot phan ten cua head (Sub-token & Substring Redundancy).
        2. Rule 3: Loc danh tu chung / tu rac o ca head lan tail (Common Noun & Non-Entity Filtering).
        3. Rule 1: Cam quan he nguoc (Antisymmetric Enforcement for Hierarchical Relations).
        """
        # --- BƯỚC 1 & 2: Lọc Substring/Sub-token & Danh từ chung ---
        for (h, r, t), fact in list(self.facts.items()):
            if fact.status != "active":
                continue
            hl = h.lower()
            tl = t.lower()
            h_tokens = set(hl.split())
            t_tokens = set(tl.split())

            # Rule 2: Tail là một phần tên của Head
            if t_tokens.issubset(h_tokens) or tl in hl:
                # Tuyệt đối cấm đối với quan hệ thuộc tính / phong cách / chất liệu / công nhận / thành phần
                if r in ("architectural_style", "made_of", "has_color", "has_height", "has_area",
                         "recognized_as", "symbol_of", "part_of"):
                    fact.status = "superseded"
                    fact.caption_allowed = False
                    continue
                if tl in ("lake", "river", "bridge", "tower", "gate", "palace", "town", "island", "bay"):
                    fact.status = "superseded"
                    fact.caption_allowed = False
                    continue

            # Head là một phần tên của Tail (Quan hệ phân cấp nội hàm trùng lặp)
            if (h_tokens.issubset(t_tokens) or hl in tl) and r in ("located_in", "part_of"):
                if hl in ("hoi an", "gate", "palace", "tower", "bridge", "temple", "pagoda", "citadel"):
                    fact.status = "superseded"
                    fact.caption_allowed = False
                    continue

            # Rule 3: Head là danh từ chung / cụm từ không định danh
            if is_common_noun_entity(h):
                fact.status = "superseded"
                fact.caption_allowed = False
                continue

            # Rule 3: Head là quốc tịch / tính từ (demonym)
            if hl in DEMONYM_WORDS and r in ("located_in", "part_of", "situated_on", "architectural_style",
                                             "symbol_of", "crosses", "connects"):
                fact.status = "superseded"
                fact.caption_allowed = False
                continue

            # Rule 3: Lọc Tail theo từng quan hệ
            if r == "architectural_style":
                if tl in {"style", "covered", "walled", "ancient", "old", "new", "modern", "small", "large", "wooden"}:
                    fact.status = "superseded"
                    fact.caption_allowed = False
                    continue
                if not ("style" in tl or "architecture" in tl or tl in {"romanesque", "gothic", "baroque", "traditional", "indochine", "champa"}):
                    fact.status = "superseded"
                    fact.caption_allowed = False
                    continue

            if r == "recognized_as":
                if tl in {"trading", "ancient", "port"} or not any(kw in tl for kw in VALID_HERITAGE_KEYWORDS):
                    fact.status = "superseded"
                    fact.caption_allowed = False
                    continue

            # Lọc Tail là danh từ chung
            if is_common_noun_entity(t):
                fact.status = "superseded"
                fact.caption_allowed = False
                continue

            # Lọc Tail là demonym (trừ khi là đối thủ chiến tranh / người xây dựng)
            if tl in DEMONYM_WORDS and r not in ("defeated", "defeated_in"):
                fact.status = "superseded"
                fact.caption_allowed = False
                continue

        # --- BƯỚC 3: Cấm quan hệ ngược (Antisymmetry Enforcement) ---
        active_facts = {k: v for k, v in self.facts.items() if v.status == "active"}
        for (h, r, t), fact in list(active_facts.items()):
            if fact.status != "active":
                continue
            if r in ("part_of", "located_in", "situated_on"):
                # 1. Cấm chu trình trực tiếp: A r B vs B r A
                rev = active_facts.get((t, r, h))
                if rev and rev.status == "active":
                    if fact.score >= rev.score:
                        rev.status = "superseded"
                        rev.caption_allowed = False
                    else:
                        fact.status = "superseded"
                        fact.caption_allowed = False
                        continue

                # 2. Cấm chu trình chéo: A part_of B vs B located_in A
                if r == "part_of":
                    rev_loc = active_facts.get((t, "located_in", h))
                    if rev_loc and rev_loc.status == "active":
                        if fact.score >= rev_loc.score:
                            rev_loc.status = "superseded"
                            rev_loc.caption_allowed = False
                        else:
                            fact.status = "superseded"
                            fact.caption_allowed = False
                            continue

                # 3. Cấm chu trình chéo: A located_in B vs B part_of A
                if r == "located_in":
                    rev_part = active_facts.get((t, "part_of", h))
                    if rev_part and rev_part.status == "active":
                        if fact.score >= rev_part.score:
                            rev_part.status = "superseded"
                            rev_part.caption_allowed = False
                        else:
                            fact.status = "superseded"
                            fact.caption_allowed = False
                            continue

    def _filter_main_connected_component(self, detected_subject: str | None = None) -> None:
        """
        Loc va chi giu lai cac Fact thuoc thanh phan lien thong chinh (Main Connected Component)
        trong do thi thuc the/quan he.
        - Neu co detected_subject / subject_hint: Thanh phan lien thong la cum chua subject nay.
        - Neu khong co: Thanh phan lien thong la cum co so luong nut (thuc the) lon nhat.
        - Cac fact khong lien thong voi do thi chinh se bi danh dau status = "disconnected".
        """
        active_facts = [f for f in self.facts.values() if f.status == "active"]
        if not active_facts:
            return

        # 1. Xay dung do thi vo huong giua cac thuc the
        adj: dict[str, set[str]] = defaultdict(set)
        for f in active_facts:
            h = f.head.strip()
            t = f.tail.strip()
            adj[h].add(t)
            adj[t].add(h)

        # 2. Tim cac thanh phan lien thong (Connected Components)
        visited: set[str] = set()
        components: list[set[str]] = []

        for node in list(adj.keys()):
            if node not in visited:
                comp: set[str] = set()
                queue = [node]
                visited.add(node)
                while queue:
                    curr = queue.pop(0)
                    comp.add(curr)
                    for nxt in adj[curr]:
                        if nxt not in visited:
                            visited.add(nxt)
                            queue.append(nxt)
                components.append(comp)

        if not components:
            return

        # 3. Xac dinh Thanh Phan Lien Thong Chinh (Main Component)
        main_component: set[str] | None = None

        if detected_subject:
            sub_clean = detected_subject.strip().lower()
            for comp in components:
                if any(sub_clean in n.lower() or n.lower() in sub_clean for n in comp):
                    main_component = comp
                    break

        if not main_component:
            main_component = max(components, key=len)

        # 4. Loai bo cac fact co nut (head hoac tail) khong thuoc main_component
        for fact in active_facts:
            h = fact.head.strip()
            t = fact.tail.strip()
            if h not in main_component or t not in main_component:
                fact.status = "disconnected"
                fact.caption_allowed = False

    def extract_batch(self, documents: list[dict[str, Any]]) -> list[Fact]:
        """
        Trich xuat hang loat cho danh sach van ban tu nhieu dia danh khac nhau.
        documents: list cac dict [{"text": "...", "source_id": "...", "subject_hint": "..."}, ...]
        """
        all_facts = []
        for doc in documents:
            text = doc.get("text", "")
            sid = doc.get("source_id", "doc")
            stype = doc.get("source_type", "wikipedia")
            hint = doc.get("subject_hint", None)
            facts = self.extract(text, source_id=sid, source_type=stype, subject_hint=hint)
            all_facts.extend(facts)
        return all_facts

    def resolve_conflicts(self, margin: float = 0.15) -> list[dict[str, Any]]:
        """
        Kiem tra va giai quyet mau thuan tren quan he don tri (single-valued).
        """
        by_hr: dict[tuple[str, str], list[Fact]] = defaultdict(list)
        for f in self.facts.values():
            if f.status != "active":
                continue
            spec = next((s for s in RELATION_SCHEMA.values() if s.canonical == f.relation), None)
            if spec and spec.single:
                by_hr[(f.head, f.relation)].append(f)

        report: list[dict[str, Any]] = []
        for (head, rel), group in by_hr.items():
            if len(group) < 2:
                continue
            group.sort(key=lambda x: x.score, reverse=True)
            top = group[0]
            second = group[1]
            resolved = (top.score - second.score) >= margin
            report.append({
                "head": head, "relation": rel,
                "winner": top.tail if resolved else None,
                "resolved": resolved,
                "candidates": [{"tail": g.tail, "score": round(g.score, 4), "diluted_score": round(g.diluted_score, 4), "mu_F": round(g.mu_F, 4)} for g in group],
            })
            if resolved:
                for g in group[1:]:
                    g.status = "superseded"
                    g.caption_allowed = False
            else:
                for g in group:
                    g.caption_allowed = False
        return report

    def export(self, tau_F: float = 0.2) -> dict[str, Any]:
        """
        Xuat node list + edge list dung cho graph embedding.
        tau_F : nguong do thuoc de fact duoc phep khang dinh trong caption (default 0.2).
        """
        nodes: dict[str, dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []
        for f in self.facts.values():
            if f.status != "active":
                continue
            for name, ntype in ((f.head, f.head_type), (f.tail, f.tail_type)):
                nodes.setdefault(name, {"id": name, "type": ntype, "degree": 0})
                nodes[name]["degree"] += 1
            score = f.score
            diluted = f.diluted_score
            mu = f.mu_F
            edges.append({
                "head": f.head, "relation": f.relation, "tail": f.tail,
                "score": round(score, 4),
                "raw_score": round(score, 4),
                "diluted_score": round(diluted, 4),
                "mu_F": round(mu, 4),
                "n_evidence": len(f.evidences),
                "sources": sorted({e.source_id for e in f.evidences}),
                "valid_from": f.valid_from, "valid_to": f.valid_to,
                "status": f.status, "version": f.version,
                "caption_allowed": bool(f.caption_allowed and score >= tau_F),
            })
        edges.sort(key=lambda e: e["score"], reverse=True)
        return {
            "meta": {
                "model": MODEL_NAME,
                "n_entity_labels": len(ENTITY_LABELS),
                "n_relation_labels": len(RELATION_LABELS),
                "tau_min": self.tau_min,
                "gamma": self.gamma,
                "tau_F": tau_F,
                "exported_at": date.today().isoformat(),
            },
            "nodes": list(nodes.values()),
            "edges": edges,
        }

    def save(self, path: str, tau_F: float = 0.2) -> None:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self.export(tau_F), fh, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# 8. DEMO KIEM THU TONG QUAT CHO NHIEU DIA DANH
# ---------------------------------------------------------------------------
TEST_CASES: list[dict[str, Any]] = [
        {
            "id": "case_1_ngoc_son",
            "name": "Case 1: Den Ngoc Son (Hanoi)",
            "text": (
                "Ngoc Son Temple is a temple on Jade Island in Hoan Kiem Lake, Hanoi. "
                "The temple is dedicated to Tran Hung Dao, a general who defeated the Mongols "
                "in the 13th century. It is connected to the shore by The Huc Bridge, a wooden "
                "bridge painted bright red that crosses the lake. The temple was built in 1841 "
                "in the traditional architectural style of the Nguyen dynasty. Turtle Tower, "
                "built in 1886, stands on a small islet in the southern part of the lake. "
                "The complex was recognized as a special national relic in 2013."
            ),
            "subject_hint": "Ngoc Son Temple",
        },
        {
            "id": "case_2_van_mieu",
            "name": "Case 2: Van Mieu - Quoc Tu Giam (Hanoi)",
            "text": (
                "The Temple of Literature is located in Hanoi, Vietnam. "
                "The temple was built in 1070 by Emperor Ly Thanh Tong "
                "of the Ly dynasty. It is dedicated to Confucius. "
                "The complex was recognized as a special national relic in 2012."
            ),
            "subject_hint": "Temple of Literature",
        },
        {
            "id": "case_3_thien_mu",
            "name": "Case 3: Chua Thien Mu (Hue)",
            "text": (
                "Thien Mu Pagoda is an ancient pagoda situated in Hue along the Perfume River. "
                "The pagoda was built in 1601 by Nguyen Hoang of the Nguyen lords. "
                "It features Phuoc Duyen Tower and overlooks the river."
            ),
            "subject_hint": "Thien Mu Pagoda",
        },
        {
            "id": "case_4_hoi_an",
            "name": "Case 4: Pho Co Hoi An & Chua Cau (Quang Nam)",
            "text": (
                "Hoi An Ancient Town is an ancient trading port located in Quang Nam province, Vietnam. "
                "The town was recognized as a UNESCO World Heritage Site in 1999. "
                "The Japanese Covered Bridge, built in the 1590s by the Japanese community, "
                "crosses a canal connecting to the Thu Bon River. "
                "The bridge is made of wood in the traditional architectural style."
            ),
            "subject_hint": "Hoi An Ancient Town",
        },
        {
            "id": "case_5_ha_long",
            "name": "Case 5: Vinh Ha Long (Quang Ninh)",
            "text": (
                "Ha Long Bay is a UNESCO World Heritage Site situated in Quang Ninh province, Vietnam. "
                "The bay features thousands of limestone islands in the Gulf of Tonkin. "
                "Sung Sot Cave, located on Bo Hon Island in the bay, was discovered by French explorers in 1901. "
                "Ti Top Island stands in the central part of the bay and is known for its crescent beach."
            ),
            "subject_hint": "Ha Long Bay",
        },
        {
            "id": "case_6_duc_ba",
            "name": "Case 6: Nha Tho Duc Ba (Ho Chi Minh City)",
            "text": (
                "Notre-Dame Cathedral of Saigon is a cathedral situated in Ho Chi Minh City, Vietnam. "
                "The cathedral was built in 1880 by French colonists in the Romanesque architectural style. "
                "The church was constructed of brick imported from France. "
                "It features two bell towers reaching a height of 58 m."
            ),
            "subject_hint": "Notre-Dame Cathedral of Saigon",
        },
        {
            "id": "case_7_dai_noi",
            "name": "Case 7: Dai Noi Hue (Thua Thien Hue)",
            "text": (
                "The Imperial City of Hue is a walled palace situated in Hue along the Perfume River. "
                "The citadel was built in 1804 by Emperor Gia Long of the Nguyen dynasty. "
                "The complex was inscribed as a UNESCO World Heritage Site in 1993. "
                "The iconic Ngo Mon Gate, built in 1833, stands as the southern entrance to the palace."
            ),
            "subject_hint": "Imperial City of Hue",
        },
    ]

if __name__ == "__main__":
    extractor = FKGFactExtractor(threshold=0.42, adjacency_threshold=0.42, relation_threshold=0.18, tau_min=0.05, gamma=0.4)

    for case in TEST_CASES:
        print(f"\n=============================================================================================")
        print(f"  {case['name']}")
        print(f"=============================================================================================")
        print(f"\n[1. VAN BAN DAU VAO / INPUT TEXT]:")
        print(f'"{case["text"]}"\n')

        extractor.facts.clear()
        extractor.extract(case["text"], source_id=case["id"], source_type="wikipedia",
                          subject_hint=case["subject_hint"])
        conflicts = extractor.resolve_conflicts(margin=0.15)
        data = extractor.export(tau_F=0.2)

        print(f"[2. DO THI TRI THUC TRICH XUAT / EXTRACTED KNOWLEDGE GRAPH]:")
        print(f"Tong so Node: {len(data['nodes'])}, Tong so Facts: {len(data['edges'])}")
        print("----------------------------------------------------------------------------------------------------------------------")
        print(f"{'Trang thai':<14} {'Head':<24} {'Quan he':<20} {'Tail':<30} {'Score (Goc)':<13} {'Score (Gian mo)':<17} {'n_ev'}")
        print("----------------------------------------------------------------------------------------------------------------------")
        for e in data["edges"]:
            flag = "[Caption OK]" if e["caption_allowed"] else "[Candidate ]"
            print(f"{flag:<14} {e['head']:<24} --[{e['relation']:<16}]--> {e['tail']:<30} {e['score']:<13.4f} {e['diluted_score']:<17.4f} {e['n_evidence']}")

        if conflicts:
            print("\n[3. GIAI QUYET MAU THUAN QUAN HE DON TRI / CONFLICT RESOLUTION]:")
            for c in conflicts:
                res_str = f"Chon: {c['winner']}" if c['resolved'] else "Chua giai quyet duoc margin"
                print(f"  - Fact ({c['head']}, {c['relation']}): {res_str}")
                for cand in c['candidates']:
                    print(f"      * {cand['tail']} (goc={cand['score']:.4f}, gian_mo={cand['diluted_score']:.4f})")

    out_path = "/tmp/fkg_facts.json"
    extractor.save(out_path, tau_F=0.2)
    print(f"\nDa luu ket qua tong hop vao: {out_path}")

