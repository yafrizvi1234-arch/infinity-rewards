import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';

export interface AvatarUploadResult {
  photoURL: string;
  storageMethod: 'firebase_storage' | 'compressed_fallback';
  note: string;
}

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_INPUT_BYTES = 5 * 1024 * 1024; // 5MB
const STORAGE_UPLOAD_TIMEOUT_MS = 6000;
const MAX_AVATAR_FALLBACK_CHARS = 130000;
const MAX_SCREENSHOT_FALLBACK_CHARS = 230000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number, errorMessage: string): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error(errorMessage));
      },
      'image/jpeg',
      quality
    );
  });
}

async function compressImageToSquareJpeg(
  file: File
): Promise<{ blob: Blob; dataUrl: string }> {
  const imageBitmap = await createImageBitmap(file);
  try {
    const minSide = Math.min(imageBitmap.width, imageBitmap.height);
    const sx = (imageBitmap.width - minSide) / 2;
    const sy = (imageBitmap.height - minSide) / 2;

    const sizeSteps = [224, 180, 144];
    const qualitySteps = [0.82, 0.68, 0.54];
    let bestDataUrl = '';
    let bestCanvas: HTMLCanvasElement | null = null;
    let bestQuality = 0.82;

    for (const targetSize of sizeSteps) {
      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas 2D context is not available in this browser.');
      }
      ctx.drawImage(imageBitmap, sx, sy, minSide, minSide, 0, 0, targetSize, targetSize);

      for (const quality of qualitySteps) {
        const candidate = canvas.toDataURL('image/jpeg', quality);
        bestDataUrl = candidate;
        bestCanvas = canvas;
        bestQuality = quality;
        if (candidate.length <= MAX_AVATAR_FALLBACK_CHARS) {
          const blob = await canvasToJpegBlob(
            canvas,
            quality,
            'Failed to encode compressed image blob.'
          );
          return { blob, dataUrl: candidate };
        }
      }
    }

    if (!bestCanvas) {
      throw new Error('Failed to encode compressed image.');
    }
    const blob = await canvasToJpegBlob(
      bestCanvas,
      bestQuality,
      'Failed to encode compressed image blob.'
    );
    return { blob, dataUrl: bestDataUrl };
  } finally {
    imageBitmap.close();
  }
}

export async function uploadProfileAvatar(uid: string, file: File): Promise<AvatarUploadResult> {
  const mimeType = file.type.toLowerCase();
  if (!ALLOWED_TYPES.includes(mimeType)) {
    throw new Error('Unsupported image format. Please choose a JPG, PNG, or WebP file.');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('Image is too large. Please select an image smaller than 5MB.');
  }

  const { blob, dataUrl } = await compressImageToSquareJpeg(file);

  try {
    const objectRef = ref(storage, `profile_avatars/${uid}/avatar_${Date.now()}.jpg`);
    const downloadUrl = await withTimeout(
      uploadBytes(objectRef, blob, { contentType: 'image/jpeg' }).then(() =>
        getDownloadURL(objectRef)
      ),
      STORAGE_UPLOAD_TIMEOUT_MS,
      'Avatar Storage upload'
    );
    return {
      photoURL: downloadUrl,
      storageMethod: 'firebase_storage',
      note: 'Profile picture uploaded to Firebase Storage.',
    };
  } catch (err) {
    console.warn(
      'Firebase Storage unavailable or unauthorized, using compressed profile image fallback:',
      err
    );
    if (dataUrl.length > MAX_AVATAR_FALLBACK_CHARS + 5000) {
      throw new Error(
        'Firebase Storage is not enabled and the compressed image exceeded Firestore limits. Please try a simpler image.'
      );
    }
    return {
      photoURL: dataUrl,
      storageMethod: 'compressed_fallback',
      note: 'Firebase Storage is not active yet — saved compressed avatar directly to your profile.',
    };
  }
}

export interface ScreenshotUploadResult {
  screenshotUrl: string;
  storageMethod: 'firebase_storage' | 'compressed_fallback';
}

async function compressPaymentScreenshotJpeg(
  file: File
): Promise<{ blob: Blob; dataUrl: string }> {
  const imageBitmap = await createImageBitmap(file);
  try {
    const maxDimensionSteps = [900, 720, 560];
    const qualitySteps = [0.78, 0.62, 0.48, 0.36];
    let bestDataUrl = '';
    let bestCanvas: HTMLCanvasElement | null = null;
    let bestQuality = 0.78;

    for (const maxDimension of maxDimensionSteps) {
      const scale = Math.min(1, maxDimension / Math.max(imageBitmap.width, imageBitmap.height));
      const width = Math.max(1, Math.round(imageBitmap.width * scale));
      const height = Math.max(1, Math.round(imageBitmap.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas 2D context is not available in this browser.');
      }
      ctx.drawImage(imageBitmap, 0, 0, width, height);

      for (const quality of qualitySteps) {
        const candidate = canvas.toDataURL('image/jpeg', quality);
        bestDataUrl = candidate;
        bestCanvas = canvas;
        bestQuality = quality;
        if (candidate.length <= MAX_SCREENSHOT_FALLBACK_CHARS) {
          const blob = await canvasToJpegBlob(
            canvas,
            quality,
            'Failed to encode payment screenshot.'
          );
          return { blob, dataUrl: candidate };
        }
      }
    }

    if (!bestCanvas) {
      throw new Error('Failed to encode payment screenshot.');
    }
    const blob = await canvasToJpegBlob(
      bestCanvas,
      bestQuality,
      'Failed to encode payment screenshot.'
    );
    return { blob, dataUrl: bestDataUrl };
  } finally {
    imageBitmap.close();
  }
}

export async function uploadPaymentScreenshot(
  uid: string,
  requestId: string,
  file: File
): Promise<ScreenshotUploadResult> {
  const mimeType = file.type.toLowerCase();
  if (!ALLOWED_TYPES.includes(mimeType)) {
    throw new Error('Unsupported screenshot format. Please upload a JPG, PNG, or WebP image.');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('Screenshot is too large. Please select an image smaller than 5MB.');
  }

  const { blob, dataUrl } = await compressPaymentScreenshotJpeg(file);

  try {
    const objectRef = ref(storage, `payment_screenshots/${uid}/${requestId}.jpg`);
    const downloadUrl = await withTimeout(
      uploadBytes(objectRef, blob, { contentType: 'image/jpeg' }).then(() =>
        getDownloadURL(objectRef)
      ),
      STORAGE_UPLOAD_TIMEOUT_MS,
      'Screenshot Storage upload'
    );
    return {
      screenshotUrl: downloadUrl,
      storageMethod: 'firebase_storage',
    };
  } catch (err) {
    console.warn('Firebase Storage unavailable for screenshot, using compressed fallback:', err);
    if (dataUrl.length > 250000) {
      throw new Error(
        'Screenshot is too detailed to compress safely. Please upload a cropped or lower-resolution screenshot.'
      );
    }
    return {
      screenshotUrl: dataUrl,
      storageMethod: 'compressed_fallback',
    };
  }
}
