import os
import requests
import json
import base64

# --- הגדרות API למודלים ---
# מפתח OpenRouter למודל הטקסט (נשאר כפי שהיה)
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY") 

# מפתח Hugging Face למודל התמונה (מעודכן עם המפתח החדש שסיפקת)
HF_API_TOKEN = os.getenv("HF_API_TOKEN") # נשתמש במשתנה הסביבה כדי לקבל את המפתח החדש

# מודל ליצירת התסריט והתיאור הויזואלי (דרך OpenRouter)
SCRIPT_AND_DESC_MODEL = "mistralai/mistral-7b-instruct:free" 

# נקודת הקצה (Endpoint) של Hugging Face Inference API למודל התמונות
HF_IMAGE_GENERATION_API_URL = "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0" 

# --- פונקציות לתקשורת עם המודלים ---

def call_openrouter_model(prompt_text, model_name=SCRIPT_AND_DESC_MODEL, temperature=0.7, max_tokens=1500):
    """
    מתקשרת עם מודלי טקסט דרך OpenRouter API.
    משמשת ליצירת תסריט וליצירת תיאור תמונה.
    """
    clean_model_name_for_referer = model_name.replace(":free", "")

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": f"https://openrouter.ai/models/{clean_model_name_for_referer}", 
        "X-Title": "Animation Creator App"
    }
    data = {
        "model": model_name, 
        "messages": [{"role": "user", "content": prompt_text}],
        "temperature": temperature,
        "max_tokens": max_tokens
    }
    try:
        response = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, data=json.dumps(data))
        response.raise_for_status() 
        return response.json()["choices"][0]["message"]["content"]
    except requests.exceptions.RequestException as e:
        print(f"שגיאה בתקשורת עם OpenRouter עבור מודל {model_name}: {e}")
        if response and response.content:
            try:
                error_details = json.loads(response.content)
                print(f"פרטי שגיאה מ-OpenRouter: {error_details}")
            except json.JSONDecodeError:
                print(f"תוכן תגובת שגיאה גולמי מ-OpenRouter: {response.content.decode('utf-8', errors='ignore')}")
        return f"שגיאה: לא ניתן היה לקבל תגובה מהמודל {model_name}."

def call_huggingface_image_generation(prompt_text):
    """
    מתקשרת עם Hugging Face Inference API ליצירת תמונות.
    מקבלת טקסט ומחזירה תמונה בפורמט Base64.
    """
    headers = {"Authorization": f"Bearer {HF_API_TOKEN}"} # השתמש במפתח שהוגדר כמשתנה סביבה
    payload = {"inputs": prompt_text} 

    try:
        response = requests.post(HF_IMAGE_GENERATION_API_URL, headers=headers, json=payload)
        response.raise_for_status() 
        
        image_bytes = response.content 
        
        if image_bytes:
            return base64.b64encode(image_bytes).decode('utf-8') 
        return None
    except requests.exceptions.RequestException as e:
        print(f"שגיאה בתקשורת עם Hugging Face ליצירת תמונה: {e}")
        if response and response.content:
            try:
                error_details = json.loads(response.content)
                print(f"פרטי שגיאה מ-HF: {error_details}")
            except json.JSONDecodeError:
                print(f"תוכן תגובת שגיאה גולמי מ-HF: {response.content.decode('utf-8', errors='ignore')}")
        return None

# --- התהליך הראשי ליצירת אנימציה אוטומטית ---

def create_full_animation_auto(user_story_idea):
    print("מתחילים! שלב 1: יצירת תסריט...")
    script_prompt = f"""
    צור תסריט קצר (3-5 סצנות) לאנימציה פשוטה. כל סצנה צריכה להיות מפורטת מספיק ליצירת תמונה.
    פרט מה קורה בכל סצנה, איפה, ומי הדמויות העיקריות, ואילו פעולות הן עושות.
    הסיפור הוא על: {user_story_idea}
    הצג כל סצנה כך:
    --- סצנה N: כותרת הסצנה ---
    תיאור ויזואלי של הסצנה.
    (דיאלוגים אם יש)
    """
    
    script_text = call_openrouter_model(script_prompt, model_name=SCRIPT_AND_DESC_MODEL, max_tokens=2000)
    print("\n--- התסריט שנוצר ---\n", script_text)
    print("\n---------------------\n")

    # --- שלב 2: פירוק התסריט לסצנות ויצירת תיאור תמונה + יצירת תמונה בפועל ---
    scenes_raw = script_text.split("--- סצנה")
    generated_frames_filenames = []

    for i, scene_block in enumerate(scenes_raw):
        if not scene_block.strip() or i == 0: 
            continue

        scene_id_and_title = scene_block.split("---", 1)[0].strip()
        scene_content = scene_block.split("---", 1)[1].strip() if "---" in scene_block else scene_block.strip()
        actual_scene_title = scene_id_and_title.split(':', 1)[1].strip() if ':' in scene_id_and_title else f"סצנה {i}"
        
        print(f"--- שלב 2 (המשך): יצירת תיאור תמונה מפורט עבור: {actual_scene_title} ---")
        desc_prompt = f"""
        בהתבסס על הסצנה הבאה, צור תיאור תמונה מפורט וברור, המתאים ליצירת פריים לאנימציה פשוטה.
        התיאור צריך להתמקד באובייקטים, דמויות, פעולות, הבעות פנים, תאורה ורקע.
        אל תכלול דיאלוגים בתיאור התמונה, רק את מה שרואים.
        הסצנה מהתסריט:
        {scene_content}
        """
        image_description = call_openrouter_model(desc_prompt, model_name=SCRIPT_AND_DESC_MODEL, max_tokens=500)
        
        if "שגיאה" in image_description:
            print(f"שגיאה ביצירת תיאור עבור {actual_scene_title}. מדלג על סצנה זו.")
            continue

        print(f"\n--- תיאור התמונה שנוצר עבור {actual_scene_title} ---\n", image_description)
        print("\n-------------------------------------------------\n")

        print(f"--- שלב 3: יצירת פריים לאנימציה עבור: {actual_scene_title} ---")
        # הפרומפט למודל יצירת התמונה (ננסה לכוון אותו לסגנון אנימציה)
        image_generation_prompt = f"""
        A simple, clean illustration in a cartoon animation style or children's illustration style. 
        The image should be clear, focused on the main characters and their expressions, with a simple, clear background.
        Visual description: {image_description}
        """
        
        generated_image_base64 = call_huggingface_image_generation(image_generation_prompt)
        
        if generated_image_base64:
            filename = f"animation_frame_scene_{i}.jpg"
            with open(filename, "wb") as f:
                f.write(base64.b64decode(generated_image_base64))
            print(f"\n--- פריים נוצר ונשמר כ- {filename} ---\n")
            generated_frames_filenames.append(filename)
        else:
            print(f"\n--- לא ניתן היה לייצר פריים עבור {actual_scene_title}. וודא שמפתח ה-API של Hugging Face נכון והמודל זמין.---\n")
    
    print("\n--- סיום יצירת פריימים. ---")
    if generated_frames_filenames:
        print("אתה יכול למצוא את התמונות בתיקייה זו.")
        print("כדי להפוך את התמונות לאנימציה (GIF/MP4), תצטרך כלי חיצוני, לדוגמה: FFmpeg או אתרי אונליין ליצירת GIF מורצף תמונות.")
    else:
        print("לא נוצרו פריימים כלל. וודא שמפתחות ה-API נכונים ושהמודלים זמינים.")

# --- הפעלת התהליך הראשי ---
if __name__ == "__main__":
    print("שלום! בוא ניצור פריימים לאנימציה באופן אוטומטי.")
    user_initial_idea = input("אנא, כתוב רעיון קצר לסיפור האנימציה שלך (לדוגמה: 'חייזר קטן נוחת בחווה ומנסה להתחבר לפרה'): ")
    create_full_animation_auto(user_initial_idea)
    print("התהליך הסתיים. תהנה!")