import sys
import json
import os

# Ensure backend directory is in path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.fkg_fact_extractor import FKGFactExtractor

def main():
    try:
        input_data = json.load(sys.stdin)
        text = input_data.get('text', '').strip()
        subject_hint = input_data.get('subject_hint', '').strip() or None
        
        if not text:
            print(json.dumps({'facts': []}))
            return

        extractor = FKGFactExtractor()
        raw_facts = extractor.extract(text, subject_hint=subject_hint)
        facts = []
        seen = set()
        for f in raw_facts:
            key = (f.head.lower(), f.relation.lower(), f.tail.lower())
            if key in seen:
                continue
            seen.add(key)
            facts.append({
                'head': f.head,
                'head_type': f.head_type,
                'relation': f.relation,
                'tail': f.tail,
                'tail_type': f.tail_type,
                'score': round(float(f.score), 4),
                'diluted_score': round(float(f.diluted_score), 4)
            })
        print(json.dumps({'facts': facts}))
    except Exception as e:
        print(json.dumps({'error': str(e)}))

if __name__ == '__main__':
    main()
