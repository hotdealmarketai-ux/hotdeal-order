// 업로드 전 클라이언트 이미지 리사이즈+압축 — 저장 비용을 크게 줄이되 실사용 화질은 유지.
// 핵심: '안 보이는 해상도'만 걷어냄(긴 변 2048px) + 품질 0.85. 디테일/글자 가독성 유지.
// 실패(HEIC 등 디코드 불가)·애니메이션(GIF)·이미 작은 파일은 원본 그대로 업로드(안전 폴백).

type Opts = { maxEdge?: number; quality?: number };

async function loadImage(file: File): Promise<{ el: CanvasImageSource; w: number; h: number; close: () => void }> {
  // EXIF 회전 반영(폰 사진 세로/가로 틀어짐 방지).
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { el: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch {
      /* 폴백으로 진행 */
    }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => resolve({ el: img, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height, close: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode fail")); };
    img.src = url;
  });
}

export async function compressImage(file: File, { maxEdge = 2048, quality = 0.85 }: Opts = {}): Promise<File> {
  if (typeof document === "undefined") return file;
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif") return file; // 애니메이션 보존
  try {
    const { el, w, h, close } = await loadImage(file);
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    // 이미 충분히 작고 용량도 작으면 재인코딩 없이 원본 유지.
    if (scale === 1 && file.size < 600 * 1024) { close(); return file; }
    const nw = Math.max(1, Math.round(w * scale));
    const nh = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = nw;
    canvas.height = nh;
    const ctx = canvas.getContext("2d");
    if (!ctx) { close(); return file; }
    ctx.fillStyle = "#fff"; // 투명 PNG가 검게 나오지 않게 흰 배경
    ctx.fillRect(0, 0, nw, nh);
    ctx.drawImage(el, 0, 0, nw, nh);
    close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file; // 오히려 커지면 원본
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file; // 디코드 실패 → 원본 업로드
  }
}
