import dotenv from 'dotenv';
import { SettlementEngine, SettlementEngineConfig } from './SettlementEngine';
import { OptionsService } from './services/OptionsService';
import { ChainConfigService } from './services/ChainConfigService';
import { TelegramConfig } from './services/TelegramService';

// Load environment variables
dotenv.config();

const {
  PRIVATE_KEY,
  API_BASE_URL = 'http://localhost:42069',
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_ENABLED = 'false',
  LOG_LEVEL_ERROR = 'true',
  LOG_LEVEL_WARN = 'false',
  LOG_LEVEL_INFO = 'false'
} = process.env;

if (!PRIVATE_KEY) {
  console.error('Missing required environment variables');
  process.exit(1);
}

async function main() {
  try {
    const chainConfigService = new ChainConfigService();
    const optionsService = new OptionsService(API_BASE_URL);

    // Configure Telegram integration
    const telegramConfig: TelegramConfig = {
      token: TELEGRAM_BOT_TOKEN || '',
      chatId: TELEGRAM_CHAT_ID || '',
      enabled: TELEGRAM_ENABLED.toLowerCase() === 'true'
    };

    // Configure which log levels should be sent to Telegram
    const logLevels = {
      error: LOG_LEVEL_ERROR.toLowerCase() === 'true',
      warn: LOG_LEVEL_WARN.toLowerCase() === 'true',
      info: LOG_LEVEL_INFO.toLowerCase() === 'true'
    };

    // Create engine configuration
    const engineConfig: SettlementEngineConfig = {
      telegram: telegramConfig,
      logLevels
    };

    console.log('Starting Settlement Engine...');
    console.log('Telegram notifications:', telegramConfig.enabled ? 'Enabled' : 'Disabled');

    const engine = new SettlementEngine(
      PRIVATE_KEY as string,
      chainConfigService,
      optionsService,
      engineConfig
    );

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('Received SIGINT. Gracefully shutting down...');
      engine.stop();
    });

    process.on('SIGTERM', () => {
      console.log('Received SIGTERM. Gracefully shutting down...');
      engine.stop();
    });

    // Start the engine
    await engine.start();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main(); 