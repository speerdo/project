import OpenAI from 'openai';
import type { WebsiteStyle } from '../types/database';

interface AIPromptResponse {
  html: string;
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

function cleanGeneratedCode(code: string): string {
  // Remove markdown code block indicators and any surrounding backticks
  return code
    .replace(/^```(html)?/gm, '')  // Remove opening code block
    .replace(/```$/gm, '')         // Remove closing code block
    .replace(/^`|`$/g, '')         // Remove single backticks
    .trim();                       // Remove extra whitespace
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
      
      const systemPrompt = 'You are an expert web designer and developer. You are tasked with creating a landing page for a business using the provided brand assets and styles.';

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
      ${style.styles.headerStyles.map(h => `Size: ${h.fontSize}, Weight: ${h.fontWeight}, Color: ${h.color}`).join('\n')}

      Visual Effects:
      ${style.styles.gradients?.length ? `Gradients:\n${style.styles.gradients.map(g => `- ${g}`).join('\n')}` : ''}
      ${style.styles.shadows?.length ? `Shadows:\n${style.styles.shadows.map(s => `- ${s}`).join('\n')}` : ''}
      ` : ''}` : '';

      const fullPrompt = `Create a high-converting, single-page landing page using ONLY the provided brand assets and styles.
        Do not introduce any new colors, fonts, or images that aren't specified in the style guide below.

      ${styleGuide}

      STRICT REQUIREMENTS:
      1. Use ONLY the brand colors, fonts, and visual assets provided.
      2. Use ONLY the fonts listed (link any required fonts to Google Fonts).
      3. Do not add any new colors, fonts, or images.
      4. Create a responsive, mobile-first layout using semantic HTML5.
      5. Include hover states for all interactive elements.
      6. Ensure accessibility compliance.
      7. Update any year references to ${new Date().getFullYear()}.
      8. Do not include navigation links in the header (only display the logo).
      9. Use Lorem Ipsum for all placeholder marketing text.
      10. Include at least 3 distinct content sections with at least 3 sentences of text each.
      11. Include a footer with the company logo, company name, and the year 2025.

      Additional Content Requirements:
      ${prompt}

      Respond ONLY with the complete HTML code including embedded CSS. Do not include any explanations or markdown.`;

      console.log('[OpenAI] Sending payload:', {
        systemPrompt,
        fullPrompt
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: systemPrompt },  // Ensure systemPrompt sets context clearly (e.g., "You are an expert web designer...")
          { role: "user", content: fullPrompt }
        ],
        temperature: 0.5, // Lowered temperature for more deterministic output; try 0.5–0.7 based on testing.
        max_tokens: 4000,
        top_p: 1,         // Adjust top_p if needed; 1 is typically fine.
        frequency_penalty: 0, // Consider increasing slightly (e.g. 0.2) if you notice repetitive output.
        presence_penalty: 0   // Adjust if necessary.
      });
      

      const generatedCode = completion.choices[0].message.content;

      if (!generatedCode) {
        throw new Error('Failed to generate landing page content');
      }

      console.log('[OpenAI] Response received:', generatedCode.substring(0, 200) + '...');

      return {
        html: cleanGeneratedCode(generatedCode),
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

  // If all retries failed, return error
  return {
    html: '',
    error: lastError?.message || 'Failed to generate content'
  };
}

export function getFallbackTemplate(style?: WebsiteStyle): string {
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

export async function updateLandingPage(
  prompt: string,
  style?: WebsiteStyle,
  currentHtml?: string
): Promise<AIPromptResponse> {
  let retries = 0;
  let lastError: Error | null = null;

  while (retries < MAX_RETRIES) {
    try {
      await waitForRateLimit();
      const openai = getOpenAIClient();
      
      const systemPrompt = 'You are a helpful assistant specialized in web development and design. Your task is to update an existing landing page while maintaining its structure and style.';

      const styleGuide = style ? `
      Available Assets (keep these unless specifically asked to change):
      ${style.colors?.length ? `Colors: ${style.colors.join(', ')}` : ''}
      ${style.fonts?.length ? `Fonts: ${style.fonts.join(', ')}` : ''}
      ${style.logo ? `Logo: ${style.logo}` : ''}
      ${style.images?.length ? `Images: ${style.images.join(', ')}` : ''}` : '';

      const fullPrompt = `Please review the provided HTML and update it according to the following prompt. Keep all existing assets, styles, and structure unless specifically asked to change them.

      ${styleGuide}

      Current HTML:
      ${currentHtml || ''}

      Update Request:
      ${prompt}

      Respond ONLY with the complete updated HTML.`;

      console.log('[OpenAI] Sending update payload:', {
        systemPrompt,
        fullPrompt
      });

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
        throw new Error('Failed to update landing page content');
      }

      return {
        html: cleanGeneratedCode(generatedCode)
      };

    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      if (!lastError.message.includes('rate_limit')) break;
      retries++;
      if (retries < MAX_RETRIES) {
        await delay(RETRY_DELAY * retries);
        continue;
      }
    }
  }

  return {
    html: '',
    error: lastError?.message || 'Failed to update content'
  };
}