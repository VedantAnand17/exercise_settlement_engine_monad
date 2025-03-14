import dotenv from "dotenv";
import { SettlementEngine, SettlementEngineConfig } from "./SettlementEngine";
import { OptionsService } from "./services/OptionsService";
import { ChainConfigService } from "./services/ChainConfigService";
import { TelegramConfig } from "./services/TelegramService";
import express from "express";
import { GetRatesRequest, GetRatesResponse } from "./types/Option";

// Load environment variables
dotenv.config();

const {
  PRIVATE_KEY,
  API_BASE_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_ENABLED = "false",
  LOG_LEVEL_ERROR = "true",
  LOG_LEVEL_WARN = "false",
  LOG_LEVEL_INFO = "false",
  SERVER_PORT = "3000",
} = process.env;

if (!PRIVATE_KEY) {
  console.error("Missing required environment variables");
  process.exit(1);
}

async function main() {
  try {
    const chainConfigService = new ChainConfigService();
    const optionsService = new OptionsService(API_BASE_URL);

    // Configure Telegram integration
    const telegramConfig: TelegramConfig = {
      token: TELEGRAM_BOT_TOKEN || "",
      chatId: TELEGRAM_CHAT_ID || "",
      enabled: TELEGRAM_ENABLED.toLowerCase() === "true",
    };

    // Configure which log levels should be sent to Telegram
    const logLevels = {
      error: LOG_LEVEL_ERROR.toLowerCase() === "true",
      warn: LOG_LEVEL_WARN.toLowerCase() === "true",
      info: LOG_LEVEL_INFO.toLowerCase() === "true",
    };

    // Create engine configuration
    const engineConfig: SettlementEngineConfig = {
      telegram: telegramConfig,
      logLevels,
    };

    console.log("Starting Settlement Engine...");
    console.log(
      "Telegram notifications:",
      telegramConfig.enabled ? "Enabled" : "Disabled"
    );

    const engine = new SettlementEngine(
      PRIVATE_KEY as string,
      chainConfigService,
      optionsService,
      engineConfig
    );

    // Set up Express server
    const app = express();
    app.use(express.json());

    // Add get-rates endpoint
    app.post("/get-rates", async (req, res) => {
      const startTime = Date.now();
      try {
        const request = req.body as GetRatesRequest;

        // Validate request
        if (
          !request.market ||
          !request.pool ||
          !request.tokenId ||
          request.isCall === undefined ||
          !request.chainId ||
          !request.internalOptions
        ) {
          return res.status(400).json({
            error: "Missing required fields",
            details: {
              market: !request.market ? "missing" : "ok",
              pool: !request.pool ? "missing" : "ok",
              tokenId: !request.tokenId ? "missing" : "ok",
              isCall: request.isCall === undefined ? "missing" : "ok",
              chainId: !request.chainId ? "missing" : "ok",
              internalOptions: !request.internalOptions ? "missing" : "ok",
            },
          });
        }

        // Validate internal options
        if (
          !Array.isArray(request.internalOptions) ||
          request.internalOptions.length === 0
        ) {
          return res.status(400).json({
            error: "Invalid internal options",
            details: "internalOptions must be a non-empty array",
          });
        }

        // Check if any internal option is missing required fields
        const invalidOptions = request.internalOptions.filter(
          (option) =>
            !option.tickLower || !option.tickUpper || !option.liquidity
        );

        if (invalidOptions.length > 0) {
          return res.status(400).json({
            error: "Invalid internal options",
            details: `${invalidOptions.length} options are missing required fields`,
          });
        }

        // Set a timeout for the request
        const timeoutMs = 60000; // 30 seconds
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error("Request timed out")), timeoutMs);
        });

        // Race the actual calculation against the timeout
        const result = (await Promise.race([
          engine.calculateOptionProfitability(request),
          timeoutPromise,
        ])) as GetRatesResponse;

        const processingTime = Date.now() - startTime;
        console.log(
          `Processed get-rates request in ${processingTime}ms for option ${request.tokenId}`
        );

        res.json({
          ...result,
          processingTimeMs: processingTime,
        });
      } catch (error) {
        const processingTime = Date.now() - startTime;
        console.error(
          `Error processing get-rates request (${processingTime}ms):`,
          error
        );

        // Determine if it's a timeout error
        if (error instanceof Error && error.message === "Request timed out") {
          return res.status(504).json({
            error: "Gateway timeout",
            message: "The request took too long to process",
            processingTimeMs: processingTime,
          });
        }

        // Handle other types of errors
        res.status(500).json({
          error: "Internal server error",
          message: error instanceof Error ? error.message : "Unknown error",
          processingTimeMs: processingTime,
        });
      }
    });

    // Start the server
    const port = parseInt(SERVER_PORT, 10);
    app.listen(port, () => {
      console.log(`API server listening on port ${port}`);
    });

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      console.log("Received SIGINT. Gracefully shutting down...");
      engine.stop();
    });

    process.on("SIGTERM", () => {
      console.log("Received SIGTERM. Gracefully shutting down...");
      engine.stop();
    });

    // Start the engine
    await engine.start();
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

main();
