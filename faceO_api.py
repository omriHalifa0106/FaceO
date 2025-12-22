import os
import json
import shutil
import cv2
import numpy as np
from deepface import DeepFace
from sklearn.cluster import DBSCAN

# --- Engine Configuration ---
MODEL_NAME = "ArcFace"
DETECTOR = "retinaface"
METRIC = "cosine"
THRESHOLD = 0.55  # Distance threshold for recognized faces


def find_cosine_distance(vector1, vector2):
    """
    Calculates the cosine distance between two embedding vectors.

    Args:
        vector1 (list/np.array): First face embedding.
        vector2 (list/np.array): Second face embedding.

    Returns:
        float: Cosine distance (1 - cosine similarity).
    """
    v1 = np.array(vector1)
    v2 = np.array(vector2)
    numerator = np.dot(v1, v2)
    denominator = np.linalg.norm(v1) * np.linalg.norm(v2)
    return 1 - (numerator / denominator)


def save_face_thumbnail(img_path, face_region, output_path):
    """
    Crops a detected face from an image and saves it as a reference thumbnail.

    Args:
        img_path (str): Path to the source image.
        face_region (dict): Dictionary containing 'x', 'y', 'w', 'h' coordinates.
        output_path (str): Destination path for the cropped face image.
    """
    img = cv2.imread(img_path)
    if img is None:
        return

    x, y, w, h = face_region['x'], face_region['y'], face_region['w'], face_region['h']
    padding = 20

    # Crop with boundary protection to prevent negative indices or exceeding image size
    y1, y2 = max(0, y - padding), min(img.shape[0], y + h + padding)
    x1, x2 = max(0, x - padding), min(img.shape[1], x + w + padding)

    face_crop = img[y1:y2, x1:x2]
    if face_crop.size > 0:
        cv2.imwrite(output_path, face_crop)


def process_with_thumbnails(db_path, scan_path, output_dir):
    """
    Main pipeline:
    1. Loads known faces from the database.
    2. Detects and recognizes faces in the scan folder.
    3. Clusters unrecognized faces using DBSCAN.
    4. Organizes images into subfolders based on identity.

    Args:
        db_path (str): Folder containing images of known people (filename = name).
        scan_path (str): Folder containing images to be sorted.
        output_dir (str): Destination folder for organized results.
    """
    json_results = {}
    face_database = []
    thumbnails_to_save = {}

    # --- Step 1: Load Known People from DB ---
    print("--- Step 1: Loading known faces from Database ---")
    if not os.path.exists(db_path):
        print(f"Error: Database path '{db_path}' does not exist!")
        return

    for person_file in os.listdir(db_path):
        if person_file.lower().endswith(('.png', '.jpg', '.jpeg')):
            name = os.path.splitext(person_file)[0]
            img_p = os.path.join(db_path, person_file)
            try:
                # Extract embedding for the reference person
                res = DeepFace.represent(img_path=img_p, model_name=MODEL_NAME, detector_backend=DETECTOR)[0]
                face_database.append({"name": name, "embedding": res["embedding"]})
            except Exception as e:
                print(f"Could not process DB image for {name}: {e}")

    # --- Step 2: Scan and Extract Faces from Input Images ---
    print("--- Step 2: Scanning and extracting faces from input folder ---")
    unknown_faces = []

    if not os.path.exists(scan_path):
        print(f"Error: Scan path '{scan_path}' does not exist!")
        return

    for filename in os.listdir(scan_path):
        if not filename.lower().endswith(('.png', '.jpg', '.jpeg')):
            continue

        img_path = os.path.join(scan_path, filename)

        try:
            # Detect all faces in the current image
            detected_faces = DeepFace.represent(img_path=img_path, model_name=MODEL_NAME,
                                                detector_backend=DETECTOR, enforce_detection=False)

            for face in detected_faces:
                emb = face["embedding"]
                region = face["facial_area"]
                best_match = None
                min_dist = float("inf")

                # Compare detected face against the database
                for db_item in face_database:
                    dist = find_cosine_distance(emb, db_item["embedding"])
                    if dist < min_dist:
                        min_dist = dist
                        best_match = db_item["name"]

                # If distance is below threshold, it's a recognized person
                if best_match and min_dist < THRESHOLD:
                    if best_match not in json_results:
                        json_results[best_match] = []
                        # Store info to save a thumbnail later
                        thumbnails_to_save[best_match] = (img_path, region)
                    json_results[best_match].append(filename)
                else:
                    # Otherwise, add to the list of unknown faces for clustering
                    unknown_faces.append({
                        "filename": filename,
                        "embedding": emb,
                        "region": region,
                        "full_path": img_path
                    })

        except Exception as e:
            print(f"Error processing file {filename}: {e}")

    # --- Step 3: Cluster Anonymous Faces ---
    if unknown_faces:
        print(f"--- Step 3: Clustering {len(unknown_faces)} unknown faces ---")
        X = np.array([f["embedding"] for f in unknown_faces])
        # DBSCAN groups faces based on cosine distance
        clustering = DBSCAN(eps=0.45, min_samples=1, metric="cosine").fit(X)

        for i, label in enumerate(clustering.labels_):
            group_name = f"Anonymous_{label}"
            if group_name not in json_results:
                json_results[group_name] = []
                thumbnails_to_save[group_name] = (unknown_faces[i]["full_path"], unknown_faces[i]["region"])
            json_results[group_name].append(unknown_faces[i]["filename"])

    # --- Step 4: Organize Results into Folders ---
    print("--- Step 4: Organizing files into output directories ---")
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    for person, files in json_results.items():
        person_folder = os.path.join(output_dir, person)
        if not os.path.exists(person_folder):
            os.makedirs(person_folder)

        # Save a reference face thumbnail in the person's folder
        if person in thumbnails_to_save:
            img_p, reg = thumbnails_to_save[person]
            save_face_thumbnail(img_p, reg, os.path.join(person_folder, "_face_reference.jpg"))

        # Copy original images (using a set to avoid duplicate copies of the same image)
        for f in set(files):
            shutil.copy2(os.path.join(scan_path, f), os.path.join(person_folder, f))

    # Save a summary report in JSON format
    with open(os.path.join(output_dir, "summary.json"), 'w', encoding='utf-8') as jf:
        json.dump(json_results, jf, ensure_ascii=False, indent=4)

    print(f"\nProcessing completed! Results are located in: {output_dir}")


if __name__ == "__main__":
    # --- Configure your paths here ---
    DB_PATH = "known_people"  # Folder with reference photos
    SCAN_PATH = "test"  # Folder with photos to organize
    OUTPUT_PATH = "final_organized"

    process_with_thumbnails(DB_PATH, SCAN_PATH, OUTPUT_PATH)