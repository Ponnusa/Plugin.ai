from PIL import Image
import os

SRC = "images"
OUT = "store-assets"
os.makedirs(OUT, exist_ok=True)

TARGET_W, TARGET_H = 1280, 800  # Chrome Web Store preferred screenshot size, 16:10


def center_crop_to_ratio(img, target_ratio):
    w, h = img.size
    current_ratio = w / h
    if current_ratio > target_ratio:
        # too wide -> crop width, keep full height
        new_w = round(h * target_ratio)
        left = (w - new_w) // 2
        box = (left, 0, left + new_w, h)
    else:
        # too tall -> crop height, keep full width
        new_h = round(w / target_ratio)
        top = (h - new_h) // 2
        box = (0, top, w, top + new_h)
    return img.crop(box)


def make_screenshot(filename, out_name, top_half=False):
    img = Image.open(os.path.join(SRC, filename)).convert("RGB")
    if top_half:
        w, h = img.size
        img = img.crop((0, 0, w, h // 2))
    cropped = center_crop_to_ratio(img, TARGET_W / TARGET_H)
    resized = cropped.resize((TARGET_W, TARGET_H), Image.LANCZOS)
    out_path = os.path.join(OUT, out_name)
    resized.save(out_path, "PNG")
    print(f"{out_name}: {resized.size}")


make_screenshot("side-panel-main.png", "screenshot-1-panel.png")
make_screenshot("onboarding-zoom.png", "screenshot-2-zoom.png")
make_screenshot("onboarding-theme.png", "screenshot-3-theme.png")
make_screenshot("contrast-themes.png", "screenshot-4-contrast-comparison.png", top_half=True)
make_screenshot("mic-setup.png", "screenshot-5-mic-setup.png")

# Small promo tile: 440x280, aspect ~11:7 -- crop from the main panel screenshot
promo_src = Image.open(os.path.join(SRC, "side-panel-main.png")).convert("RGB")
promo_cropped = center_crop_to_ratio(promo_src, 440 / 280)
promo_resized = promo_cropped.resize((440, 280), Image.LANCZOS)
promo_resized.save(os.path.join(OUT, "small-promo-440x280.png"), "PNG")
print("small-promo-440x280.png:", promo_resized.size)
