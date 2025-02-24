import { Chain } from 'viem/chains';
import winston from 'winston';

export interface ChainConfig {
  rpcUrl: string;
  swapRouterSwapper: string;
  autoExercise: string;
}

export class ChainConfigService {
  private chainConfigs: Map<number, ChainConfig>;
  private readonly logger: winston.Logger;

  constructor() {
    this.chainConfigs = new Map();
    
    // Initialize logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'chain-config.log' })
      ]
    });
  }

  private loadConfig(chainId: number): ChainConfig {
    this.logger.info(`Loading configuration for chain ${chainId}`);
    
    // Log all relevant environment variables for debugging
    const envVars = {
      rpcUrl: process.env[`RPC_URL_${chainId}`],
      swapRouterSwapper: process.env[`SWAP_ROUTER_SWAPPER_${chainId}`],
      autoExercise: process.env[`AUTO_EXERCISE_${chainId}`]
    };
    
    this.logger.info('Environment variables:', { chainId, envVars });

    const rpcUrl = process.env[`RPC_URL_${chainId}`];
    if (!rpcUrl) {
      this.logger.error(`Missing RPC_URL_${chainId} in environment variables`);
      throw new Error(`Missing RPC_URL_${chainId} in environment variables`);
    }

    const swapRouterSwapper = process.env[`SWAP_ROUTER_SWAPPER_${chainId}`];
    if (!swapRouterSwapper) {
      this.logger.error(`Missing SWAP_ROUTER_SWAPPER_${chainId} in environment variables`);
      throw new Error(`Missing SWAP_ROUTER_SWAPPER_${chainId} in environment variables`);
    }

    const autoExercise = process.env[`AUTO_EXERCISE_${chainId}`];
    if (!autoExercise) {
      this.logger.error(`Missing AUTO_EXERCISE_${chainId} in environment variables`);
      throw new Error(`Missing AUTO_EXERCISE_${chainId} in environment variables`);
    }

    const config = {
      rpcUrl,
      swapRouterSwapper,
      autoExercise,
    };

    this.chainConfigs.set(chainId, config);
    this.logger.info(`Successfully loaded configuration for chain ${chainId}`, { config });
    return config;
  }

  getConfig(chainId: number): ChainConfig {
    const config = this.chainConfigs.get(chainId);
    if (!config) {
      return this.loadConfig(chainId);
    }
    return config;
  }

  getRpcUrl(chainId: number): string {
    try {
      return this.getConfig(chainId).rpcUrl;
    } catch (error) {
      // If no config found, try to use a fallback RPC URL if provided
      const fallbackRpcUrl = process.env.FALLBACK_RPC_URL;
      if (fallbackRpcUrl) {
        this.logger.warn(`Using fallback RPC URL for chain ${chainId}`);
        return fallbackRpcUrl;
      }
      throw error;
    }
  }

  getSwapRouterSwapper(chainId: number): string {
    return this.getConfig(chainId).swapRouterSwapper;
  }

  getAutoExercise(chainId: number): string {
    return this.getConfig(chainId).autoExercise;
  }
} 