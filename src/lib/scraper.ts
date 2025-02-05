import { storeProjectAssets } from './storage';
import { supabase } from './supabase';
import type { WebsiteStyle } from '../types/database';

// Add reliable Unsplash fallback images
const FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1606857521015-7f9fcf423740?w=1200&q=80', // Hero image
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&q=80', // Feature 1
  'https://images.unsplash.com/photo-1551434678-e076c223a692?w=1200&q=80', // Feature 2
  'https://images.unsplash.com/photo-1506765515384-028b60a970df?w=1200&q=80', // Feature 3
  'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1200&q=80'  // Feature 4
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
  using_default_styles: boolean;
}

function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

async function fetchExternalStylesheet(styleUrl: string, baseUrl: string): Promise<string> {
  try {
    const fullUrl = styleUrl.startsWith('http') ? styleUrl : new URL(styleUrl, baseUrl).href;
    console.log('[CSS] Fetching stylesheet:', fullUrl);
    
    const params = new URLSearchParams({
      'api_key': import.meta.env.VITE_SCRAPINGBEE_API_KEY,
      'url': fullUrl,
      'render_js': 'false',
      'premium_proxy': 'true'
    });
    
    const response = await fetch(`https://app.scrapingbee.com/api/v1/?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch stylesheet: ${response.status}`);
    }
    
    const css = await response.text();
    
    // Log and check for font-family rules
    console.log('[CSS] Checking for font-family rules in:', fullUrl);
    const fontFamilyRules = css.match(/font-family:\s*([^;}]+)[;}]/g);
    if (fontFamilyRules) {
      console.log('[CSS] Found font-family rules:', fontFamilyRules);
    }
    
    // Check for @import rules
    const importRules = css.match(/@import\s+(?:url\(['"]?([^'")]+)['"]?\)|['"]([^'"]+)['"]);/g);
    if (importRules) {
      console.log('[CSS] Found @import rules:', importRules);
      
      // Extract URLs from import rules
      const importUrls = importRules.map(rule => {
        const urlMatch = rule.match(/['"]([^'"]+)['"]/);
        return urlMatch ? urlMatch[1] : null;
      }).filter(Boolean);
      
      // Fetch imported stylesheets
      const importedStyles = await Promise.all(
        importUrls.map(importUrl => {
          if (importUrl) {
            console.log('[CSS] Fetching imported stylesheet:', importUrl);
            return fetchExternalStylesheet(importUrl, baseUrl);
          }
          return '';
        })
      );
      
      // Combine all CSS
      return [css, ...importedStyles].join('\n');
    }
    
    return css;
  } catch (error) {
    console.error('[CSS] Error fetching stylesheet:', error);
    return '';
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
    'timeout': '30000',
    'wait': '5000'
  });

  const requestUrl = `${baseUrl}?${params.toString()}`;
  console.log('[ScrapingBee] Making request:', { url: cleanUrl, withJs, retryCount });

  try {
    const response = await fetch(requestUrl);
    console.log('[ScrapingBee] Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ScrapingBee] Error response:', errorText);
      
      if (response.status === 401 && errorText.includes('API calls limit reached')) {
        throw new Error('API_LIMIT_REACHED');
      }
      
      throw new Error(`ScrapingBee API error: ${response.status} - ${errorText}`);
    }

    let html = await response.text();
    console.log('[ScrapingBee] Full HTML response length:', html.length);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Find and fetch all external stylesheets
    const cssLinks = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
    console.log('[CSS] Found stylesheet links:', cssLinks.length);
    
    const stylesheets = await Promise.all(
      cssLinks.map(async (link) => {
        const href = link.getAttribute('href');
        if (!href) return '';
        const resolvedHref = resolveUrl(cleanUrl, href);
        return fetchExternalStylesheet(resolvedHref, cleanUrl);
      })
    );
    
    // Log all fetched stylesheets
    stylesheets.forEach((css, index) => {
      console.log(`[CSS] Stylesheet ${index + 1} content length:`, css.length);
    });

    // Inject external stylesheets into the HTML as <style> tags
    const styleContent = stylesheets.filter(Boolean).join('\n');
    if (styleContent) {
      const styleTag = doc.createElement('style');
      styleTag.textContent = styleContent;
      doc.head.appendChild(styleTag);
      
      // Remove existing link tags to avoid duplicate styles
      cssLinks.forEach(link => link.remove());
      
      // Get the updated HTML with injected styles
      html = doc.documentElement.outerHTML;
    }

    return html;
  } catch (error) {
    console.error('[ScrapingBee] Request failed:', error);
    
    if (error instanceof Error && error.message === 'API_LIMIT_REACHED') {
      throw error;
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
      retries: log.retries,
      using_default_styles: log.using_default_styles
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
  // First try brand-specific selectors if brand is provided
  if (brand) {
    const brandLower = brand.toLowerCase();
    const brandSelectors = [
      // Exact brand name matches first
      `img[src*="${brandLower}-logo"]`,
      `img[src*="logo-${brandLower}"]`,
      `img[src*="${brandLower}_logo"]`,
      `img[src*="logo_${brandLower}"]`,
      `img[alt*="${brandLower} logo"]`,
      // Then header/nav brand matches
      `header img[src*="${brandLower}"]`,
      `nav img[src*="${brandLower}"]`,
      // Then any brand image matches with common dimensions
      `img[src*="${brandLower}"][width="32"]`,
      `img[src*="${brandLower}"][width="64"]`,
      `img[src*="${brandLower}"][width="100"]`,
      `img[src*="${brandLower}"][width="128"]`,
      `img[src*="${brandLower}"][width="200"]`,
    ];

    for (const selector of brandSelectors) {
      const img = doc.querySelector(selector);
      if (img) {
        const src = img.getAttribute('src') || img.getAttribute('data-src');
        if (src) {
          console.log('[Scraping] Found brand logo with selector:', selector);
          return resolveUrl(doc.baseURI, src);
        }
      }
    }
  }

  // Fallback to generic logo selectors
  const genericLogoSelectors = [
    'header img[src*="logo"]',
    'header img[alt*="logo"]',
    'nav img[src*="logo"]',
    'nav img[alt*="logo"]',
    '.logo img',
    'img.logo',
    'img[src*="logo"]',
    'img[alt*="logo"]'
  ];

  for (const selector of genericLogoSelectors) {
    const img = doc.querySelector(selector);
    if (img) {
      const src = img.getAttribute('src') || img.getAttribute('data-src');
      if (src) {
        console.log('[Scraping] Found generic logo with selector:', selector);
        return resolveUrl(doc.baseURI, src);
      }
    }
  }

  // Last resort: Look for square images in header/nav
  const headerNavImages = Array.from(doc.querySelectorAll('header img, nav img'))
    .filter(img => {
      const width = parseInt(img.getAttribute('width') || '0');
      const height = parseInt(img.getAttribute('height') || '0');
      return (width === height) && (width >= 32 && width <= 200);
    });

  if (headerNavImages.length > 0) {
    const src = headerNavImages[0].getAttribute('src');
    if (src) {
      console.log('[Scraping] Found potential logo by dimensions in header/nav');
      return resolveUrl(doc.baseURI, src);
    }
  }

  return undefined;
}

function findImages(doc: Document): string[] {
  const images = new Set<string>();
  
  // 1. Hero images (highest priority)
  const heroSelectors = [
    '.hero img', 
    '[class*="hero"] img',
    'header img:not([src*="logo"])',
    'main > section:first-child img'
  ];

  heroSelectors.forEach(selector => {
    const img = doc.querySelector(selector);
    if (img?.getAttribute('src')) {
      images.add(resolveUrl(doc.baseURI, img.getAttribute('src')!));
    }
  });

  // 2. Featured/Large images
  const largeImages = Array.from(doc.querySelectorAll('img'))
    .filter(img => {
      const width = parseInt(img.getAttribute('width') || '0');
      const height = parseInt(img.getAttribute('height') || '0');
      const src = img.getAttribute('src') || '';
      return (
        (width >= 600 || height >= 400) &&
        !src.includes('logo') &&
        /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(src)
      );
    })
    .map(img => img.getAttribute('src')!)
    .filter(Boolean)
    .map(src => resolveUrl(doc.baseURI, src));

  largeImages.forEach(src => images.add(src));

  // 3. Content section images
  const contentSelectors = [
    '.features img',
    '.products img',
    '.gallery img',
    'article img',
    'section img'
  ];

  contentSelectors.forEach(selector => {
    doc.querySelectorAll(selector).forEach(img => {
      const src = img.getAttribute('src');
      if (src && /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(src)) {
        images.add(resolveUrl(doc.baseURI, src));
      }
    });
  });

  // 4. Background images in inline styles
  const elementsWithBackground = Array.from(doc.querySelectorAll('*'))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter(el => {
      const bg = el.style.backgroundImage;
      return bg && bg !== 'none';
    });

  elementsWithBackground.forEach(el => {
    const bg = el.style.backgroundImage;
    const urlMatch = bg.match(/url\(['"]?([^'")]+)['"]?\)/);
    if (urlMatch && urlMatch[1]) {
      images.add(resolveUrl(doc.baseURI, urlMatch[1]));
    }
  });

  // Convert to array, filter out duplicates and small images, limit to 5
  return Array.from(images)
    .filter(src => !src.includes('logo'))
    .slice(0, 5);
}

function extractColors(doc: Document): string[] {
  const colors = new Set<string>();
  
  // Extract colors from style attributes and CSS
  const elements = doc.querySelectorAll('[style], [class]');
  elements.forEach(el => {
    // Check inline styles
    const style = el.getAttribute('style');
    if (style) {
      const colorMatches = style.match(/(#[0-9A-Fa-f]{3,6}|rgb\([^)]+\)|rgba\([^)]+\))/g);
      if (colorMatches) {
        colorMatches
          .filter(color => 
            !color.includes('var(') && 
            !['inherit', 'transparent', 'currentColor'].includes(color))
          .forEach(color => colors.add(color));
      }
    }
  });

  // Look for style tags
  doc.querySelectorAll('style').forEach(styleEl => {
    const css = styleEl.textContent || '';
    const colorMatches = css.match(/(#[0-9A-Fa-f]{3,6}|rgb\([^)]+\)|rgba\([^)]+\))/g);
    if (colorMatches) {
      colorMatches
        .filter(color => 
          !color.includes('var(') && 
          !['inherit', 'transparent', 'currentColor'].includes(color))
        .forEach(color => colors.add(color));
    }
  });

  return Array.from(colors).slice(0, 5) || DEFAULT_STYLE.colors;
}

function extractFonts(doc: Document): string[] {
  const fonts = new Set<string>();
  
  // Extract fonts from style attributes and CSS
  doc.querySelectorAll('style').forEach(styleEl => {
    const css = styleEl.textContent || '';
    const fontMatches = css.match(/font-family:\s*([^;}"']+)/g);
    if (fontMatches) {
      fontMatches.forEach(font => {
        const fontFamily = font.replace('font-family:', '').trim();
        const firstFont = fontFamily.split(',')[0].replace(/['"]/g, '').trim();
        if (!firstFont.includes('var(') && 
            !['inherit', 'system-ui', '-apple-system', 'sans-serif', 'serif', 'monospace'].includes(firstFont)) {
          fonts.add(firstFont);
        }
      });
    }
  });

  // Check for Google Fonts
  doc.querySelectorAll('link[href*="fonts.googleapis.com"]').forEach(link => {
    const href = link.getAttribute('href') || '';
    const familyMatch = href.match(/family=([^&:]+)/);
    if (familyMatch) {
      const family = familyMatch[1].replace(/\+/g, ' ');
      fonts.add(family);
    }
  });

  return Array.from(fonts).slice(0, 3) || DEFAULT_STYLE.fonts;
}

export async function scrapeWebsite(url: string, projectId: string, brand?: string): Promise<WebsiteStyle> {
  console.log('[Scraping] Starting to scrape website:', url);
  const startTime = Date.now();
  const retries = 0;
  let usingDefaultStyles = false;
  
  try {
    const html = await makeScrapingBeeRequest(url, true);
    console.log('[Scraping] Received HTML response');
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Extract colors and fonts
    const extractedColors = extractColors(doc);
    const extractedFonts = extractFonts(doc);
    
    console.log('[Scraping] Extracted colors:', extractedColors);
    console.log('[Scraping] Extracted fonts:', extractedFonts);

    // Extract meta description
    const metaDescription = doc.querySelector('meta[name="description"]')?.getAttribute('content');
    console.log('[Scraping] Meta description:', metaDescription);
    
    // Find logo first with brand prioritization
    const logoUrl = findLogo(doc, brand);
    const logo = logoUrl ? resolveUrl(url, logoUrl) : undefined;
    console.log('[Scraping] Found logo:', logo);

    // Find all images (expand to 5)
    const imageUrls = findImages(doc);
    const images = Array.from(imageUrls)
      .map(imgUrl => resolveUrl(url, imgUrl))
      .filter(Boolean);
    console.log('[Scraping] Found images:', images);

    // Combine with fallback images if needed
    const finalImages = [
      ...images,
      ...FALLBACK_IMAGES.slice(images.length)
    ].slice(0, 5); // Ensure maximum of 5 images

    // Process and store assets
    const processedAssets = await storeProjectAssets(projectId, {
      images: finalImages,
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
        colors: extractedColors.length,
        fonts: extractedFonts.length,
        images: processedAssets.images.length,
        logo: !!processedAssets.logo,
        styles: true
      },
      duration_ms: duration,
      retries,
      using_default_styles: usingDefaultStyles
    });

    const result = {
      ...DEFAULT_STYLE,
      colors: extractedColors.length > 0 ? extractedColors : DEFAULT_STYLE.colors,
      fonts: extractedFonts.length > 0 ? extractedFonts : DEFAULT_STYLE.fonts,
      images: finalImages,
      logo,
      metaDescription
    };
    
    console.log('[Scraping] Final result:', result);
    return result as WebsiteStyle;

  } catch (error) {
    usingDefaultStyles = true;
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
        retries,
        using_default_styles: usingDefaultStyles
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
      retries,
      using_default_styles: usingDefaultStyles
    });

    return DEFAULT_STYLE;
  }
}