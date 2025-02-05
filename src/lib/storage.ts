import { supabase } from './supabase';

// Add reliable Unsplash fallback images
const FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1606857521015-7f9fcf423740?w=1200&q=80',
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&q=80'
];

async function ensureStorageBucket() {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const bucketName = 'project-assets';
    
    if (!buckets?.find(b => b.name === bucketName)) {
      const { error } = await supabase.storage.createBucket(bucketName, {
        public: true,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
      });
      
      if (error) {
        console.error('Error creating storage bucket:', error);
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error('Error ensuring storage bucket:', error);
    return false;
  }
}

function isValidImageUrl(url: string): boolean {
  try {
    // Skip validation for data URLs
    if (url.startsWith('data:')) {
      return false;
    }

    // For Unsplash images, just return true
    if (url.includes('images.unsplash.com')) {
      return true;
    }

    // Check if URL has a valid image extension
    const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
    const urlPath = new URL(url).pathname.toLowerCase();
    return validExtensions.some(ext => urlPath.endsWith(ext));
  } catch {
    return false;
  }
}

export async function downloadAndStoreImage(url: string, projectId: string): Promise<string | null> {
  try {
    // Skip storage for data URLs
    if (url.startsWith('data:')) {
      return null;
    }

    // For Unsplash images, just return the URL with quality parameters
    if (url.includes('images.unsplash.com')) {
      return url.includes('?') ? url : `${url}?w=1200&q=80`;
    }

    // Validate image URL first
    if (!isValidImageUrl(url)) {
      console.error(`Invalid image URL format: ${url}`);
      return null;
    }

    // Ensure storage bucket exists
    const bucketExists = await ensureStorageBucket();
    if (!bucketExists) {
      console.error('Failed to ensure storage bucket exists');
      return null;
    }

    // Generate a unique filename
    const filename = `${projectId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${getImageExtension(url)}`;
    
    try {
      // For now, just return the original URL if it's a valid image URL
      // This avoids CORS issues while still providing the image functionality
      return url;
    } catch (error) {
      console.error(`Error processing image ${url}:`, error);
      return null;
    }
  } catch (error) {
    console.error('Error storing image:', error);
    return null;
  }
}

function getImageExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop()?.toLowerCase();
    return ext && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext) ? ext : 'jpg';
  } catch {
    return 'jpg';
  }
}

export async function storeProjectAssets(
  projectId: string,
  assets: { images: string[]; logo?: string }
): Promise<{
  images: string[];
  logo?: string;
}> {
  const storedAssets = {
    images: [] as string[],
    logo: undefined as string | undefined
  };

  // Process logo first if exists
  if (assets.logo) {
    const storedLogo = await downloadAndStoreImage(assets.logo, projectId);
    if (storedLogo) {
      storedAssets.logo = storedLogo;
      
      // Create asset record
      await supabase.from('assets').insert({
        project_id: projectId,
        type: 'logo',
        url: storedLogo
      });
    }
  }

  // Process images
  const imagePromises = assets.images.map(async (url) => {
    const storedUrl = await downloadAndStoreImage(url, projectId);
    if (storedUrl) {
      // Create asset record
      await supabase.from('assets').insert({
        project_id: projectId,
        type: 'image',
        url: storedUrl
      });
      return storedUrl;
    }
    return null;
  });

  const storedUrls = await Promise.all(imagePromises);
  storedAssets.images = storedUrls.filter((url): url is string => url !== null);

  // If no images were successfully stored, use fallback images
  if (storedAssets.images.length === 0) {
    storedAssets.images = FALLBACK_IMAGES;
  }

  return storedAssets;
}