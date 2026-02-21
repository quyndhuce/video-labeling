
* Thiếu Full Video Caption: Nhãn cho cả video
* Temporal Segmentation (phân đoạn video): Thiếu "primary_activity": "camera_movement",
* knowledge cần link đến knowledge_id: trong knowledge_id cần mô tả rõ các thuộc tính của knowledge, có thể tự sinh bằng llm. 
```json
{
  "knowledge_base_version": "1.0",
  "last_updated": "2024-03-15",
  
  "objects": {
    "van_mieu_gate": {
      "canonical_name_vi": "Văn Miếu Môn",
      "canonical_name_en": "Van Mieu Gate / Temple of Literature Main Gate",
      "aliases": ["Văn Miếu", "cổng chính Văn Miếu"],
      
      "object_type": "architecture",
      "subtype": "gate",
      
      "historical_info": {
        "built_year": 1070,
        "dynasty": "Lý Dynasty",
        "built_by": "Emperor Lý Thánh Tông",
        "renovations": [
          {"year": 1805, "description": "Major renovation"},
          {"year": 2000, "description": "UNESCO restoration"}
        ]
      },
      
      "cultural_significance": {
        "unesco_status": "Part of Temple of Literature complex on Tentative List",
        "symbolism": "Tam tài (Heaven, Earth, Human) represented by three roof tiers",
        "cultural_practices": [
          "Students touch the gate for good luck before exams",
          "Traditional entry point for scholars"
        ]
      },
      
      "architectural_details": {
        "style": "Confucian temple architecture",
        "height_meters": 12,
        "width_meters": 15,
        "materials": ["wood", "brick", "ceramic_tiles"],
        "features": [
          "Three-tiered curved roofs",
          "Yin-yang tile pattern",
          "Wooden pillars with carvings",
          "Dragon motifs"
        ]
      },
      
      "related_entities": {
        "part_of": "van_mieu_complex",
        "connected_to": ["dai_trung_gate", "khue_van_pavilion"],
        "associated_people": ["Confucius", "Ly_Thanh_Tong"],
        "associated_concepts": ["Confucianism", "scholarly_tradition"]
      },
      
      "media": {
        "reference_images": ["kb_images/van_mieu_gate_01.jpg"],
        "3d_model": null,
        "external_links": [
          "https://vanmieu.gov.vn",
          "https://whc.unesco.org/..."
        ]
      }
    },
    
    "stele_1442_exam": {
      "canonical_name_vi": "Bia tiến sĩ khoa 1442",
      "canonical_name_en": "Doctoral Stele of 1442 Examination",
      
      "object_type": "artifact",
      "subtype": "stone_stele",
      
      "historical_info": {
        "created_year": 1442,
        "dynasty": "Lê Dynasty",
        "examination_year": 1442,
        "number_of_graduates": 25
      },
      
      "cultural_significance": {
        "unesco_status": "Memory of the World Register (2010)",
        "symbolism": "Turtle represents longevity of knowledge",
        "importance": "One of 82 remaining steles documenting Vietnam's scholarly tradition"
      },
      
      "physical_details": {
        "material": "bluestone",
        "height_cm": 180,
        "width_cm": 120,
        "weight_kg": 800,
        "components": ["turtle_base", "stele_body", "decorative_top"]
      },
      
      "inscriptions": {
        "content_type": "names_of_doctoral_graduates",
        "language": "Classical Chinese",
        "notable_names": ["Nguyễn Trãi", "..."]
      },
      
      "related_entities": {
        "part_of": "van_mieu_complex",
        "series": "82_doctoral_steles",
        "associated_concepts": ["imperial_examination", "Confucian_education"]
      }
    },
    
    // Các objects khác...
    "khue_van_pavilion": {...},
    "dai_trung_gate": {...},
    "incense_burner": {...}
  },
  
  // Entities khác (people, concepts, events)
  "people": {
    "Ly_Thanh_Tong": {
      "name_vi": "Lý Thánh Tông",
      "name_en": "Emperor Ly Thanh Tong",
      "reign": "1054-1072",
      "achievements": ["Founded Temple of Literature", "Promoted Confucian education"],
      "related_sites": ["van_mieu_complex"]
    }
  },
  
  "concepts": {
    "Confucianism": {
      "name_vi": "Nho giáo",
      "description_vi": "Hệ tư tưởng triết học và đạo đức do Khổng Tử sáng lập",
      "description_en": "Philosophical and ethical system founded by Confucius",
      "key_values": ["respect_for_learning", "filial_piety", "moral_cultivation"]
    }
  }
}
```

* Tạo thư viện objects chuẩn

* object thêm  "class": "gate",    