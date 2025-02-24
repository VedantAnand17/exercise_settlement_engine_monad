import dotenv from 'dotenv';
import { SettlementEngine } from './SettlementEngine';
import { OptionsService } from './services/OptionsService';
import { ChainConfigService } from './services/ChainConfigService';

// Load environment variables
dotenv.config();

const {
  PRIVATE_KEY,
  API_BASE_URL = 'http://localhost:42069'
} = process.env;

if (!PRIVATE_KEY) {
  console.error('Missing required environment variables');
  process.exit(1);
}

async function main() {
  try {
    const chainConfigService = new ChainConfigService();
    const optionsService = new OptionsService(API_BASE_URL);

    console.log('Starting Settlement Engine...');

    const engine = new SettlementEngine(
      PRIVATE_KEY as string,
      chainConfigService,
      optionsService
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