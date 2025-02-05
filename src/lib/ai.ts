import OpenAI from 'openai';
import type { WebsiteStyle } from '../types/database';

interface AIPromptResponse {
  html: string;
  css: string;
  error?: string;
}

let openaiClient: OpenAI | null = null;
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 20000; // 20 seconds between requests
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

function getOpenAIClient() {
  if (!openaiClient) {
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key is not configured');
    }
    openaiClient = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: true
    });
  }
  return openaiClient;
}

async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => 
      setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
    );
  }
  
  lastRequestTime = Date.now();
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function generateLandingPage(
  prompt: string,
  style?: WebsiteStyle
): Promise<AIPromptResponse> {
  let retries = 0;
  let lastError: Error | null = null;

  while (retries < MAX_RETRIES) {
    try {
      await waitForRateLimit();
      const openai = getOpenAIClient();
      
      const systemPrompt = 'You are a helpful assistant specialized in web development and design.';

      const styleGuide = style ? `
Style Guide:
${style.colors?.length ? `Brand Colors (use exactly):
${style.colors.map(color => `- ${color}`).join('\n')}` : 'Use modern, professional colors'}

${style.fonts?.length ? `Typography (use exactly):
${style.fonts.map(font => `- ${font}`).join('\n')}` : 'Use system fonts'}

${style.logo ? `Brand Logo: ${style.logo}` : ''}

${style.images?.length ? `Visual Assets (use exactly):
${style.images.map(img => `- ${img}`).join('\n')}` : ''}

${style.metaDescription ? `Meta Description: ${style.metaDescription}` : ''}

${style.headings?.length ? `Key Headings:
${style.headings.map(h => `- ${h}`).join('\n')}` : ''}

${style.styles ? `
Layout Specifications:
- Container Width: ${style.styles.layout.maxWidth}
- Padding: ${style.styles.layout.containerPadding}
- Section Spacing: ${style.styles.layout.gridGap}

Call-to-Action Buttons:
${style.styles.buttonStyles.map(btn => `- Background: ${btn.backgroundColor}, Text: ${btn.color}, Padding: ${btn.padding}, Radius: ${btn.borderRadius}`).join('\n')}

Heading Styles:
${style.styles.headerStyles.map(h => `- Font: ${h.fontFamily}, Size: ${h.fontSize}, Weight: ${h.fontWeight}, Color: ${h.color}`).join('\n')}

Visual Effects:
${style.styles.gradients?.length ? `Gradients:\n${style.styles.gradients.map(g => `- ${g}`).join('\n')}` : ''}
${style.styles.shadows?.length ? `Shadows:\n${style.styles.shadows.map(s => `- ${s}`).join('\n')}` : ''}
` : ''}` : '';

      const fullPrompt = `Create a high-converting, single-page landing page that captures the essence and branding of the reference website. The landing page should have a modern design with a responsive, semantic HTML5 layout, include interactive hover states on buttons, meet accessibility standards, and drive user action without a full navigation menu. Use the exact branding details provided below and insert Lorem Ipsum text as placeholder content (unless specific marketing text is provided).

${styleGuide}

Requirements:
1. Use ONLY the exact colors, fonts, and styles specified above
2. Create a responsive layout that works on all devices using semantic HTML5 elements
3. Include hover states for interactive elements
4. Ensure accessibility compliance
5. Use provided background colors and images
6. Include the logo and images in appropriate sections
7. Follow the exact spacing and layout values provided
8. Make sure any years are updated to the current year ${new Date().getFullYear()}
9. Make sure that unless specified below, do not include any navigation or links in the header other than the logo
10. Use Lorem Ipsum for all text content unless otherwise specified below.

Additional Content Requirements:
${prompt}

Respond ONLY with the complete HTML code including embedded CSS. Do not include any explanations or markdown.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: fullPrompt }
        ],
        temperature: 0.7,
        max_tokens: 4000,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0
      });

      const generatedCode = completion.choices[0].message.content;

      if (!generatedCode) {
        throw new Error('Failed to generate landing page content');
      }

      return {
        html: generatedCode,
        css: '',
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      
      const isRetryable = 
        lastError.message.includes('rate_limit') ||
        lastError.message.includes('timeout') ||
        lastError.message.includes('network') ||
        lastError.message.includes('internal_error');

      if (!isRetryable) {
        break;
      }

      retries++;
      if (retries < MAX_RETRIES) {
        await delay(RETRY_DELAY * retries);
        continue;
      }
    }
  }

  return {
    html: getFallbackTemplate(prompt, style),
    css: '',
    error: lastError?.message || 'Failed to generate content'
  };
}

export function getFallbackTemplate(prompt: string, style?: WebsiteStyle): string {
  const primaryColor = style?.colors?.[0] || '#4F46E5';
  const textColor = style?.colors?.[1] || '#1F2937';
  const backgroundColor = style?.colors?.[2] || '#F9FAFB';
  const fontFamily = style?.fonts?.[0] || 'system-ui, -apple-system, sans-serif';
  const logo = style?.logo;
  const images = style?.images || [];
  const headerStyle = style?.styles?.headerStyles?.[0] || {
    fontSize: '2.25rem',
    fontWeight: '700',
    color: '#1F2937',
    fontFamily: 'system-ui'
  };
  const buttonStyle = style?.styles?.buttonStyles?.[0] || {
    backgroundColor: '#4F46E5',
    color: '#FFFFFF',
    padding: '0.75rem 1.5rem',
    borderRadius: '0.375rem'
  };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${style?.metaDescription || 'Transform your business with our powerful solution'}">
    <title>Welcome | Landing Page</title>
    <style>
        :root {
            --primary-color: ${primaryColor};
            --text-color: ${textColor};
            --bg-color: ${backgroundColor};
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        html {
            scroll-behavior: smooth;
        }
        
        body {
            margin: 0;
            font-family: ${fontFamily};
            color: var(--text-color);
            background-color: var(--bg-color);
            line-height: 1.5;
        }
        
        .container {
            max-width: ${style?.styles?.layout?.maxWidth || '1200px'};
            margin: 0 auto;
            padding: ${style?.styles?.layout?.containerPadding || '2rem'};
        }
        
        .hero {
            min-height: 80vh;
            display: flex;
            align-items: center;
            text-align: center;
            padding: 4rem 2rem;
            background: ${style?.styles?.gradients?.[0] || 'transparent'};
        }
        
        .hero h1 {
            font-size: clamp(2rem, 5vw, ${headerStyle.fontSize});
            font-weight: ${headerStyle.fontWeight};
            color: ${headerStyle.color};
            margin-bottom: 1.5rem;
            line-height: 1.2;
        }
        
        .hero p {
            font-size: clamp(1rem, 2.5vw, 1.25rem);
            margin-bottom: 2rem;
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
        }
        
        .button {
            display: inline-block;
            background-color: ${buttonStyle.backgroundColor};
            color: ${buttonStyle.color};
            padding: ${buttonStyle.padding};
            border-radius: ${buttonStyle.borderRadius};
            text-decoration: none;
            transition: all 0.3s ease;
            box-shadow: ${style?.styles?.shadows?.[0] || '0 1px 3px rgba(0,0,0,0.1)'};
        }
        
        .button:hover {
            transform: translateY(-2px);
            box-shadow: ${style?.styles?.shadows?.[1] || '0 4px 6px rgba(0,0,0,0.1)'};
        }
        
        .logo {
            max-width: 200px;
            margin-bottom: 2rem;
            animation: fadeIn 1s ease-out;
        }
        
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: ${style?.styles?.layout?.gridGap || '2rem'};
            padding: 4rem 0;
        }
        
        .feature {
            text-align: center;
            padding: 2rem;
            background: white;
            border-radius: ${style?.styles?.borderRadius?.[0] || '0.5rem'};
            box-shadow: ${style?.styles?.shadows?.[0] || '0 1px 3px rgba(0,0,0,0.1)'};
            transition: transform 0.3s ease;
        }
        
        .feature:hover {
            transform: translateY(-5px);
        }
        
        .feature img {
            width: 100%;
            max-width: 300px;
            height: 200px;
            object-fit: cover;
            border-radius: ${style?.styles?.borderRadius?.[0] || '0.5rem'};
            margin-bottom: 1.5rem;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        @media (max-width: 768px) {
            .hero {
                min-height: 60vh;
                padding: 2rem 1rem;
            }
            .features {
                grid-template-columns: 1fr;
                gap: 1.5rem;
                padding: 2rem 0;
            }
        }
    </style>
</head>
<body>
    <div class="hero">
        <div class="container">
            ${logo ? `<img src="${logo}" alt="Logo" class="logo">` : ''}
            <h1>${style?.headings?.[0] || 'Transform Your Business Today'}</h1>
            <p>${style?.headings?.[1] || 'We\'re crafting the perfect solution to help your business grow. Stay tuned for our exciting launch.'}</p>
            <a href="#contact" class="button">Get Started</a>
        </div>
    </div>
    
    <div class="container">
        <div class="features">
            ${images.slice(0, 3).map((img, i) => `
            <div class="feature">
                <img src="${img}" alt="Feature ${i + 1}" loading="lazy">
                <h3>${style?.headings?.[i + 2] || `Feature ${i + 1}`}</h3>
                <p>Experience the power of innovation with our cutting-edge solutions.</p>
            </div>
            `).join('')}
        </div>
    </div>
</body>
</html>`;
}