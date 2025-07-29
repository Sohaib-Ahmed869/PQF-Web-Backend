const axios = require("axios");

// DeepL Pro API configuration
const DEEPL_API_KEY = process.env.DEEPL_API_KEY || "your-api-key-here";
const DEEPL_API_URL = "https://api.deepl.com/v2/translate";

// Pro API rate limits (much higher than Free)
const RATE_LIMIT = {
  maxRequestsPerSecond: 50,
  requestInterval: 25,
  maxCharactersPerRequest: 50000,
  maxTextsPerBatch: 50, // Larger batches for efficiency
  dailyCharacterLimit: 1000000, // 1M characters per day for Pro
};

// Enhanced rate limiter optimized for Pro API
class ProRateLimiter {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.lastRequestTime = 0;
    this.requestCount = 0;
    this.windowStart = Date.now();
    this.charactersUsed = 0;
    this.dailyReset = Date.now() + 24 * 60 * 60 * 1000; // Reset daily counter
  }

  async addRequest(requestFn, estimatedChars = 0) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        requestFn,
        resolve,
        reject,
        timestamp: Date.now(),
        estimatedChars,
      });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();

      // Reset daily character count
      if (now > this.dailyReset) {
        this.charactersUsed = 0;
        this.dailyReset = now + 24 * 60 * 60 * 1000;
      }

      // Reset per-second counter
      if (now - this.windowStart >= 1000) {
        this.requestCount = 0;
        this.windowStart = now;
      }

      // Check rate limits
      if (this.requestCount >= RATE_LIMIT.maxRequestsPerSecond) {
        const waitTime = 1000 - (now - this.windowStart);
        if (waitTime > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }
      }

      const { requestFn, resolve, reject, estimatedChars } = this.queue.shift();

      // Check daily character limit
      if (
        this.charactersUsed + estimatedChars >
        RATE_LIMIT.dailyCharacterLimit
      ) {
        reject(new Error("Daily character limit would be exceeded"));
        continue;
      }

      try {
        // Ensure minimum interval between requests (much shorter for Pro)
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < RATE_LIMIT.requestInterval) {
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              RATE_LIMIT.requestInterval - timeSinceLastRequest
            )
          );
        }

        const result = await requestFn();
        this.lastRequestTime = Date.now();
        this.requestCount++;
        this.charactersUsed += estimatedChars;
        resolve(result);

        // Minimal delay for Pro API
        await new Promise((resolve) => setTimeout(resolve, 10));
      } catch (error) {
        console.error("Request failed:", error.message);

        if (error.response?.status === 429) {
          // Rate limit hit - wait longer and retry
          console.log("Rate limit hit, waiting and requeuing...");
          await new Promise((resolve) => setTimeout(resolve, 5000));
          this.queue.unshift({ requestFn, resolve, reject, estimatedChars });
          continue;
        }

        if (error.response?.status === 456) {
          // Character limit exceeded
          console.log("Character limit exceeded");
          reject(new Error("Monthly character limit exceeded"));
          continue;
        }

        reject(error);
      }
    }

    this.processing = false;
  }

  getStats() {
    return {
      queueLength: this.queue.length,
      charactersUsed: this.charactersUsed,
      dailyLimit: RATE_LIMIT.dailyCharacterLimit,
      remainingChars: RATE_LIMIT.dailyCharacterLimit - this.charactersUsed,
      nextReset: new Date(this.dailyReset).toISOString(),
    };
  }
}

const rateLimiter = new ProRateLimiter();

class TranslationController {
  // Test endpoint with Pro API check
  static async testApi(req, res) {
    try {
      // Test the Pro API connection
      const response = await axios.get("https://api.deepl.com/v2/usage", {
        headers: {
          Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        },
        timeout: 5000,
      });

      res.json({
        message: "DeepL Pro API service is running",
        timestamp: new Date().toISOString(),
        rateLimits: RATE_LIMIT,
        usage: response.data,
        stats: rateLimiter.getStats(),
      });
    } catch (error) {
      res.status(500).json({
        message: "DeepL Pro API test failed",
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Single translation endpoint for Pro API
  static async translateSingle(req, res) {
    try {
      const { text, target_lang, source_lang } = req.body;

      if (!text || !target_lang) {
        return res.status(400).json({
          error: "Missing required fields: text and target_lang",
        });
      }

      // Skip very short or non-translatable content
      if (text.trim().length < 2 || /^[^a-zA-Z]*$/.test(text.trim())) {
        return res.json({
          success: true,
          translation: text,
          detected_source_language: source_lang || "EN",
          skipped: true,
        });
      }

      // Check text length against Pro limits
      if (text.length > RATE_LIMIT.maxCharactersPerRequest) {
        return res.status(400).json({
          error: `Text too long. Maximum ${RATE_LIMIT.maxCharactersPerRequest} characters allowed.`,
        });
      }

      const translateFn = async () => {
        console.log(
          `Translating: "${text.substring(0, 50)}..." (${
            text.length
          } chars) to ${target_lang}`
        );

        const params = new URLSearchParams({
          text: text.trim(),
          target_lang: target_lang,
        });

        // Only add source_lang if provided
        if (source_lang) {
          params.append("source_lang", source_lang);
        }

        const response = await axios.post(DEEPL_API_URL, params, {
          headers: {
            Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          timeout: 30000, // Longer timeout for Pro API
        });
        return response.data;
      };

      const data = await rateLimiter.addRequest(translateFn, text.length);

      res.json({
        success: true,
        translation: data.translations[0].text,
        detected_source_language: data.translations[0].detected_source_language,
        stats: rateLimiter.getStats(),
      });
    } catch (error) {
      TranslationController.handleTranslationError(error, res);
    }
  }

  // Optimized batch translation for Pro API
  static async translateBatch(req, res) {
    try {
      const { texts, target_lang, source_lang } = req.body;

      if (!texts || !Array.isArray(texts) || !target_lang) {
        return res.status(400).json({
          error: "Missing required fields: texts (array) and target_lang",
        });
      }

      console.log(`Processing batch of ${texts.length} texts`);

      // Filter and prepare texts for translation
      const processedTexts = texts.map((text, index) => ({
        originalIndex: index,
        text: text || "",
        needsTranslation:
          text &&
          text.trim().length > 1 &&
          !/^[^a-zA-Z]*$/.test(text.trim()) &&
          text.trim().length < RATE_LIMIT.maxCharactersPerRequest,
      }));

      const textsToTranslate = processedTexts.filter(
        (item) => item.needsTranslation
      );

      if (textsToTranslate.length === 0) {
        return res.json({
          success: true,
          translations: texts,
          message: "No texts required translation",
        });
      }

      console.log(`Translating ${textsToTranslate.length} texts with Pro API`);

      // For Pro API, we can process in smaller batches more efficiently
      const batchSize = RATE_LIMIT.maxTextsPerBatch;
      const translatedResults = [];

      for (let i = 0; i < textsToTranslate.length; i += batchSize) {
        const batch = textsToTranslate.slice(i, i + batchSize);
        const batchTexts = batch.map((item) => item.text.trim());

        try {
          const translateFn = async () => {
            const params = new URLSearchParams();

            // Add all texts to the batch request
            batchTexts.forEach((text) => {
              params.append("text", text);
            });

            params.append("target_lang", target_lang);
            if (source_lang) {
              params.append("source_lang", source_lang);
            }

            const response = await axios.post(DEEPL_API_URL, params, {
              headers: {
                Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              timeout: 60000, // Longer timeout for batch requests
            });
            return response.data;
          };

          const totalChars = batchTexts.reduce(
            (sum, text) => sum + text.length,
            0
          );
          const result = await rateLimiter.addRequest(translateFn, totalChars);

          // Add translations from this batch
          result.translations.forEach((translation) => {
            translatedResults.push(translation.text);
          });

          // Progress logging
          console.log(
            `Completed batch ${Math.floor(i / batchSize) + 1}, translated ${
              translatedResults.length
            }/${textsToTranslate.length} texts`
          );
        } catch (error) {
          console.error(
            `Batch translation failed for batch starting at ${i}:`,
            error.message
          );

          // Fallback: translate individually for this batch
          for (const item of batch) {
            try {
              const translateFn = async () => {
                const response = await axios.post(
                  DEEPL_API_URL,
                  new URLSearchParams({
                    text: item.text.trim(),
                    target_lang: target_lang,
                    ...(source_lang && { source_lang: source_lang }),
                  }),
                  {
                    headers: {
                      Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
                      "Content-Type": "application/x-www-form-urlencoded",
                    },
                    timeout: 30000,
                  }
                );
                return response.data;
              };

              const result = await rateLimiter.addRequest(
                translateFn,
                item.text.length
              );
              translatedResults.push(result.translations[0].text);
            } catch (individualError) {
              console.error(
                `Individual translation failed:`,
                individualError.message
              );
              translatedResults.push(item.text); // Fallback to original
            }
          }
        }
      }

      // Reconstruct the full translations array
      const finalTranslations = new Array(texts.length);
      let translatedIndex = 0;

      processedTexts.forEach((item) => {
        if (item.needsTranslation) {
          finalTranslations[item.originalIndex] =
            translatedResults[translatedIndex] || item.text;
          translatedIndex++;
        } else {
          finalTranslations[item.originalIndex] = item.text;
        }
      });

      res.json({
        success: true,
        translations: finalTranslations,
        stats: {
          total: texts.length,
          translated: textsToTranslate.length,
          skipped: texts.length - textsToTranslate.length,
        },
        rateLimiterStats: rateLimiter.getStats(),
      });
    } catch (error) {
      console.error("Batch translation error:", error);

      res.status(500).json({
        error: "Batch translation failed",
        details: error.message,
      });
    }
  }

  // Enhanced usage statistics for Pro API
  static async getUsage(req, res) {
    try {
      const response = await axios.get("https://api.deepl.com/v2/usage", {
        headers: {
          Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        },
      });

      res.json({
        ...response.data,
        rateLimiterStats: rateLimiter.getStats(),
        apiType: "Pro",
        limits: RATE_LIMIT,
      });
    } catch (error) {
      console.error("Usage check error:", error);
      res.status(500).json({
        error: "Usage service unavailable",
        details: error.message,
      });
    }
  }

  // Health check endpoint
  static async healthCheck(req, res) {
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      apiType: "DeepL Pro",
      stats: rateLimiter.getStats(),
    });
  }

  // Error handler helper
  static handleTranslationError(error, res) {
    console.error("Translation error:", error.message);

    if (error.response?.status === 403) {
      return res.status(403).json({
        error: "Authentication failed. Please check your DeepL Pro API key.",
        details: "Make sure you're using a valid DeepL Pro API key",
      });
    }

    if (error.response?.status === 429) {
      return res.status(429).json({
        error: "Rate limit exceeded. Please wait and try again.",
        retryAfter: 5,
      });
    }

    if (error.response?.status === 456) {
      return res.status(456).json({
        error: "Character limit exceeded for your DeepL Pro plan.",
      });
    }

    if (error.response) {
      return res.status(error.response.status).json({
        error: `DeepL API error: ${error.response.status}`,
        details: error.response.data,
      });
    }

    if (error.message === "Daily character limit would be exceeded") {
      return res.status(429).json({
        error: "Daily character limit would be exceeded",
        stats: rateLimiter.getStats(),
      });
    }

    res.status(500).json({
      error: "Translation service temporarily unavailable",
      details: error.message,
    });
  }
}

module.exports = TranslationController;