import { storeProjectAssets } from './storage';
import { supabase } from './supabase';
import type { WebsiteStyle } from '../types/database';

// Add reliable Unsplash fallback images
const FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1606857521015-7f9fcf423740?w=1200&q=80', // Hero image
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&q=80', // Feature 1
  'https://images.unsplash.com/photo-1551434678-e076c223a692?w=1200&q=80'  // Feature 2
];

// Default fallback styles
const DEFAULT_STYLE: WebsiteStyle = {
  colors: ['#1a1a1a', '#ffffff', '#3b82f6', '#4F46E5', '#7C3AED'],
  fonts: ['system-ui', '-apple-system', 'sans-serif'],
  images: FALLBACK_IMAGES,
  styles: {
    spacing: ['0.5rem', '1rem', '1.5rem', '2rem'],
    borderRadius: ['0.25rem', '0.5rem', '0.75rem'],
    shadows: [
      '0 1px 3px rgba(0,0,0,0.1)',
      '0 4px 6px rgba(0,0,0,0.1)',
      '0 10px 15px rgba(0,0,0,0.1)'
    ],
    gradients: [
      'linear-gradient(to right, #4F46E5, #7C3AED)',
      'linear-gradient(to bottom, #F9FAFB, #F3F4F6)'
    ],
    buttonStyles: [{
      backgroundColor: '#4F46E5',
      color: '#FFFFFF',
      padding: '0.75rem 1.5rem',
      borderRadius: '0.375rem'
    }],
    headerStyles: [{
      fontSize: '2.25rem',
      fontWeight: '700',
      color: '#1F2937',
      fontFamily: 'system-ui'
    }],
    layout: {
      maxWidth: '1200px',
      containerPadding: '2rem',
      gridGap: '2rem'
    }
  }
};

interface ScrapingLog {
  timestamp: string;
  url: string;
  success: boolean;
  assets_found: {
    colors: number;
    fonts: number;
    images: number;
    logo: boolean;
    styles: boolean;
  };
  errors?: string[];
  duration_ms: number;
  retries: number;
}

function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

async function makeScrapingBeeRequest(url: string, withJs: boolean = true, retryCount: number = 0): Promise<string> {
  const apiKey = import.meta.env.VITE_SCRAPINGBEE_API_KEY;
  if (!apiKey) {
    throw new Error('ScrapingBee API key is not configured');
  }

  const cleanUrl = url.trim();
  if (!validateUrl(cleanUrl)) {
    throw new Error('Invalid URL format. Please use http:// or https://');
  }

  const baseUrl = 'https://app.scrapingbee.com/api/v1/';
  const params = new URLSearchParams({
    'api_key': apiKey,
    'url': cleanUrl,
    'render_js': withJs.toString(),
    'premium_proxy': 'true',
    'block_ads': 'true',
    'block_resources': 'false',
    'country_code': 'us',
    'device': 'desktop',
    'timeout': '30000'
  });

  const requestUrl = `${baseUrl}?${params.toString()}`;
  console.log('[ScrapingBee] Making request:', { url: cleanUrl, withJs, retryCount });

  try {
    const response = await fetch(requestUrl);
    console.log('[ScrapingBee] Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ScrapingBee] Error response:', errorText);
      
      // Check for API limit error specifically
      if (response.status === 401 && errorText.includes('API calls limit reached')) {
        throw new Error('API_LIMIT_REACHED');
      }
      
      throw new Error(`ScrapingBee API error: ${response.status} - ${errorText}`);
    }

    const html = await response.text();
    console.log('[ScrapingBee] Response content length:', html.length);
    console.log('[ScrapingBee] Response preview:', html.substring(0, 500));
    return html;
  } catch (error) {
    console.error('[ScrapingBee] Request failed:', error);
    
    if (error instanceof Error && error.message === 'API_LIMIT_REACHED') {
      throw error; // Let the caller handle this specific error
    }
    
    if (retryCount < 2) {
      console.log(`[ScrapingBee] Retrying request (attempt ${retryCount + 1})...`);
      await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
      return makeScrapingBeeRequest(url, withJs, retryCount + 1);
    }
    throw error;
  }
}

async function logScrapingResult(projectId: string, log: ScrapingLog): Promise<void> {
  try {
    await supabase.from('scraping_logs').insert({
      project_id: projectId,
      url: log.url,
      success: log.success,
      assets_found: log.assets_found,
      errors: log.errors,
      duration_ms: log.duration_ms,
      retries: log.retries
    });
  } catch (error) {
    console.error('Failed to store scraping log:', error);
  }
}

function resolveUrl(baseUrl: string, url: string): string {
  try {
    if (!url) return '';
    if (url.startsWith('data:')) return '';
    
    if (url.includes('local-credentialless.webcontainer-api.io')) {
      const urlParts = url.split('/');
      const assetPath = urlParts.slice(urlParts.indexOf('assets')).join('/');
      return new URL(assetPath, baseUrl).href;
    }
    
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('//')) return `https:${url}`;
    return new URL(url, baseUrl).href;
  } catch (error) {
    console.error('Error resolving URL:', error);
    return '';
  }
}

function findLogo(doc: Document, brand?: string): string | undefined {
  // First, try to find logo in header or nav
  const header = doc.querySelector('header, nav');
  if (header) {
    const headerLogo = Array.from(header.querySelectorAll('img'))
      .find(img => {
        const src = (img.getAttribute('src') || '').toLowerCase();
        const alt = (img.getAttribute('alt') || '').toLowerCase();
        const className = (img.className || '').toLowerCase();
        return ['logo', 'brand', ...(brand ? [brand.toLowerCase()] : [])]
          .some(term => src.includes(term) || alt.includes(term) || className.includes(term));
      });
    if (headerLogo) {
      return headerLogo.getAttribute('src') || headerLogo.getAttribute('data-src');
    }
  }

  // Fallback to searching entire document
  const logoImg = Array.from(doc.querySelectorAll('img'))
    .find(img => {
      const src = (img.getAttribute('src') || '').toLowerCase();
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      const className = (img.className || '').toLowerCase();
      return ['logo', 'brand', ...(brand ? [brand.toLowerCase()] : [])]
        .some(term => src.includes(term) || alt.includes(term) || className.includes(term));
    });

  return logoImg?.getAttribute('src') || logoImg?.getAttribute('data-src');
}

function findHeroImage(doc: Document): string | undefined {
  // First try to find hero section
  const heroSection = doc.querySelector('.hero, [class*="hero"], #hero, [id*="hero"]');
  if (heroSection) {
    const heroImg = heroSection.querySelector('img');
    if (heroImg) {
      return heroImg.getAttribute('src') || heroImg.getAttribute('data-src');
    }
  }

  // Look for large images above the fold
  const aboveFoldImages = Array.from(doc.querySelectorAll('img'))
    .filter(img => {
      const rect = img.getBoundingClientRect();
      return rect.top < window.innerHeight;
    })
    .filter(img => {
      const width = parseInt(img.getAttribute('width') || '0');
      const height = parseInt(img.getAttribute('height') || '0');
      return width > 600 || height > 400;
    })
    .map(img => img.getAttribute('src') || img.getAttribute('data-src'))
    .filter(Boolean);

  return aboveFoldImages[0];
}

function findFeatureImages(doc: Document): string[] {
  // Look for images in feature sections or cards
  const featureImages = Array.from(doc.querySelectorAll('.features, [class*="feature"], .cards, [class*="card"]'))
    .flatMap(section => Array.from(section.querySelectorAll('img')))
    .map(img => img.getAttribute('src') || img.getAttribute('data-src'))
    .filter(Boolean)
    .filter(src => /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(src))
    .slice(0, 3); // Get up to 3 feature images

  return featureImages;
}

export async function scrapeWebsite(url: string, projectId: string, brand?: string): Promise<WebsiteStyle> {
  console.log('[Scraping] Starting website scrape:', { url, projectId, brand });
  const startTime = Date.now();
  const errors: string[] = [];
  let retryCount = 0;
  
  try {
    const html = await makeScrapingBeeRequest(url);
    console.log('[Scraping] Received HTML response');
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Extract meta description
    const metaDescription = doc.querySelector('meta[name="description"]')?.getAttribute('content');
    console.log('[Scraping] Meta description:', metaDescription);
    
    // Find logo
    const logoUrl = findLogo(doc, brand);
    const logo = logoUrl ? resolveUrl(url, logoUrl) : undefined;
    console.log('[Scraping] Found logo:', logo);

    // Find hero image
    const heroUrl = findHeroImage(doc);
    const heroImage = heroUrl ? resolveUrl(url, heroUrl) : FALLBACK_IMAGES[0];
    console.log('[Scraping] Found hero image:', heroImage);

    // Find feature images
    const featureUrls = findFeatureImages(doc);
    const featureImages = featureUrls
      .map(imgUrl => resolveUrl(url, imgUrl))
      .filter(Boolean)
      .slice(0, 2); // Limit to 2 feature images
    console.log('[Scraping] Found feature images:', featureImages);

    // Combine images, ensuring we have at least 3 images total
    const images = [
      heroImage,
      ...featureImages,
      ...FALLBACK_IMAGES.slice(featureImages.length + 1)
    ].slice(0, 3);
    console.log('[Scraping] Final image selection:', images);

    // Process and store assets
    const processedAssets = await storeProjectAssets(projectId, {
      images,
      logo
    });
    console.log('[Scraping] Processed assets:', processedAssets);

    const duration = Date.now() - startTime;

    // Log the scraping result
    await logScrapingResult(projectId, {
      timestamp: new Date().toISOString(),
      url,
      success: true,
      assets_found: {
        colors: DEFAULT_STYLE.colors?.length || 0,
        fonts: DEFAULT_STYLE.fonts?.length || 0,
        images: processedAssets.images.length,
        logo: !!processedAssets.logo,
        styles: true
      },
      duration_ms: duration,
      retries: retryCount
    });

    const result = {
      ...DEFAULT_STYLE,
      images: processedAssets.images,
      logo: processedAssets.logo,
      metaDescription
    };
    
    console.log('[Scraping] Final result:', result);
    return result;

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Scraping] Error:', errorMessage);
    
    // Special handling for API limit error
    if (error instanceof Error && error.message === 'API_LIMIT_REACHED') {
      console.log('[Scraping] API limit reached, using default styles');
      
      await logScrapingResult(projectId, {
        timestamp: new Date().toISOString(),
        url,
        success: false,
        assets_found: {
          colors: DEFAULT_STYLE.colors?.length || 0,
          fonts: DEFAULT_STYLE.fonts?.length || 0,
          images: FALLBACK_IMAGES.length,
          logo: false,
          styles: true
        },
        errors: ['API calls limit reached - using default styles'],
        duration_ms: duration,
        retries: retryCount
      });

      return DEFAULT_STYLE;
    }
    
    await logScrapingResult(projectId, {
      timestamp: new Date().toISOString(),
      url,
      success: false,
      assets_found: {
        colors: 0,
        fonts: 0,
        images: 0,
        logo: false,
        styles: false
      },
      errors: [errorMessage],
      duration_ms: duration,
      retries: retryCount
    });

    return DEFAULT_STYLE;
  }
}