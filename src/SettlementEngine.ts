import {
  createPublicClient,
  http,
  createWalletClient,
  parseEther,
  formatEther,
  type PublicClient,
  type WalletClient,
  Chain,
  defineChain,
  encodeFunctionData,
  encodeDeployData,
  encodePacked,
  Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, optimism, arbitrum } from "viem/chains";
import { OptionsService } from "./services/OptionsService";
import { ChainConfigService } from "./services/ChainConfigService";
import { TelegramService, TelegramConfig } from "./services/TelegramService";
import { TelegramTransport } from "./services/TelegramTransport";
import { ProfitabilityCalculator } from "./services/ProfitabilityCalculator";
import {
  Option,
  GetRatesRequest,
  GetRatesResponse,
  ProfitabilityResult,
} from "./types/Option";
import winston from "winston";
import { AutoExerciseABI } from "./abis/AutoExerciseABI";
import { SwapRouterSwapperABI } from "./abis/SwapRouterSwapperABI";
import { OptionMarketABI } from "./abis/OptionMarketABI";
import { UniswapV3PoolABI } from "./abis/UniswapV3PoolABI";
import { quoterABI } from "./abis/QuoterV2ABI";
import { Pool, Position, NonfungiblePositionManager } from "@uniswap/v3-sdk";
import { Token, CurrencyAmount, Percent } from "@uniswap/sdk-core";
import JSBI from "jsbi";
import { TickMath, SqrtPriceMath, FullMath } from "@uniswap/v3-sdk";

// opData returns [opTickArrayLen, tickLower, tickUpper, expiry, isCall]
type OptionData = readonly [bigint, number, number, bigint, boolean];

// settleOption parameters
interface SettleOptionParams {
  optionId: bigint;
  swapper: readonly `0x${string}`[];
  swapData: readonly `0x${string}`[];
  liquidityToSettle: readonly bigint[];
}

export interface SettlementEngineConfig {
  telegram?: TelegramConfig;
  logLevels?: {
    error?: boolean;
    warn?: boolean;
    info?: boolean;
    http?: boolean;
    verbose?: boolean;
    debug?: boolean;
    silly?: boolean;
  };
}

export class SettlementEngine {
  private readonly optionsService: OptionsService;
  private readonly chainConfigService: ChainConfigService;
  private readonly telegramService: TelegramService;
  private readonly profitabilityCalculator: ProfitabilityCalculator;
  private readonly privateKey: string;
  private readonly logger: winston.Logger;
  private isRunning: boolean = false;
  private readonly chainConfigs: Map<number, Chain> = new Map();
  private cacheCleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    privateKey: string,
    chainConfigService: ChainConfigService,
    optionsService: OptionsService,
    config?: SettlementEngineConfig
  ) {
    this.optionsService = optionsService;
    this.chainConfigService = chainConfigService;
    this.privateKey = privateKey;

    // Initialize Telegram service if config is provided
    this.telegramService = new TelegramService(config?.telegram);

    // Initialize logger with Telegram transport if enabled
    const transports: winston.transport[] = [
      new winston.transports.Console(),
      new winston.transports.File({ filename: "settlement-engine.log" }),
    ];

    // Add Telegram transport if Telegram is enabled
    if (config?.telegram?.enabled) {
      transports.push(
        new TelegramTransport({
          telegramService: this.telegramService,
          level: "info",
          levels: config.logLevels,
        })
      );
    }

    this.logger = winston.createLogger({
      level: "info",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports,
    });

    // Initialize the profitability calculator
    this.profitabilityCalculator = new ProfitabilityCalculator(
      chainConfigService,
      this.logger
    );
  }

  async start() {
    if (this.isRunning) {
      this.logger.warn("Settlement engine is already running");
      return;
    }

    this.isRunning = true;
    this.logger.info("Starting settlement engine");

    // Start cache cleanup interval
    this.cacheCleanupInterval = setInterval(() => this.cleanupCache(), 300000); // Clean every 5 minutes

    while (this.isRunning) {
      try {
        await this.processExpiringOptions();
        await this.processExpiredOptions();
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Poll every 10 seconds
      } catch (error) {
        this.logger.error("Error in main loop:", error);
      }
    }

    // Clear interval when stopping
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }
  }

  stop() {
    this.isRunning = false;
    this.logger.info("Stopping settlement engine");

    // Clear cache cleanup interval
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }
  }

  private getChainConfig(chainId: number): Chain {
    let chain = this.chainConfigs.get(chainId);

    if (!chain) {
      // Create a new chain configuration
      chain = defineChain({
        id: chainId,
        name: `Chain ${chainId}`,
        network: `network-${chainId}`,
        nativeCurrency: {
          decimals: 18,
          name: "Native Token",
          symbol: "ETH",
        },
        rpcUrls: {
          default: {
            http: [this.chainConfigService.getRpcUrl(chainId)],
          },
          public: {
            http: [this.chainConfigService.getRpcUrl(chainId)],
          },
        },
      });

      this.chainConfigs.set(chainId, chain);
    }

    return chain;
  }

  private createClientsForChain(chainId: number): {
    publicClient: PublicClient;
    walletClient: WalletClient;
  } {
    let chain;
    const rpcUrl = this.chainConfigService.getRpcUrl(chainId);

    if (chainId === 8450) {
      chain = defineChain({
        id: 8450,
        name: "Base",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: {
          default: {
            http: [this.chainConfigService.getRpcUrl(chainId)],
          },
        },
        blockExplorers: {
          default: {
            name: "Basescan",
            url: "https://basescan.org",
            apiUrl: "https://api.basescan.org/api",
          },
        },
        contracts: {
          multicall3: {
            address: "0xca11bde05977b3631167028862be2a173976ca11",
            blockCreated: 5022,
          },
        },
      });
    } else {
      chain = this.getChainConfig(chainId);
    }

    // Create public client
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    }) as PublicClient;

    // Create wallet client
    const account = privateKeyToAccount(this.privateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    }) as WalletClient;

    return { publicClient, walletClient };
  }

  private async processExpiringOptions() {
    try {
      const { options } = await this.optionsService.getExpiringOptions();
      // This is the specific log event we want to send to Telegram
      this.logger.info(`Processing ${options.length} expiring options`, {
        event: "processing_expiring_options",
        count: options.length,
        timestamp: new Date().toISOString(),
      });

      for (const option of options) {
        await this.handleExpiringOption(option);
      }
    } catch (error) {
      this.logger.error("Error processing expiring options:", error);
    }
  }

  private async processExpiredOptions() {
    try {
      const { options } = await this.optionsService.getExpiredOptions();
      this.logger.info(`Processing ${options.length} expired options`);

      for (const option of options) {
        await this.handleExpiredOption(option);
      }
    } catch (error) {
      this.logger.error("Error processing expired options:", error);
    }
  }

  private async handleExpiringOption(option: Option) {
    this.logger.info(`Handling expiring option ${option.tokenId}`, { option });

    try {
      const { publicClient, walletClient } = this.createClientsForChain(
        option.chainId
      );

      // Create a request for profitability calculation
      const request: GetRatesRequest = {
        chainId: option.chainId,
        market: option.market,
        pool: option.market, // Initially use market as pool
        tokenId: option.tokenId,
        isCall: option.isCall,
        internalOptions: option.internalOptions.map((internalOption) => ({
          tickLower: internalOption.tickLower,
          tickUpper: internalOption.tickUpper,
          liquidity: internalOption.liquidityAtLive,
        })),
      };

      // Calculate profitability using the profitability calculator
      const profitabilityResult =
        await this.profitabilityCalculator.calculateOptionProfitability(
          request
        );

      // Log profitability details
      this.logger.info(`Profitability analysis for option ${option.tokenId}`, {
        totalProfit: profitabilityResult.totalProfit,
        isProfitable: profitabilityResult.isProfitable,
        details: profitabilityResult.details,
      });

      // Check if there's any liquidity to exercise
      const totalLiquidityToExercise =
        profitabilityResult.exerciseParams?.liquidityToExercise.reduce(
          (sum, liquidity) => sum + BigInt(liquidity || "0"),
          BigInt(0)
        ) || BigInt(0);

      if (totalLiquidityToExercise === BigInt(0)) {
        this.logger.info(
          `No profitable liquidity to exercise for option ${option.tokenId}`
        );
        return;
      }

      const autoExerciseAddress = this.chainConfigService.getAutoExercise(
        option.chainId
      );

      // Calculate executor fee (e.g., 5% of profit)
      const executorFee = BigInt(100000); // 5% in basis points (out of 10000)

      // Execute auto-exercise transaction
      const hash = await walletClient.writeContract({
        address: autoExerciseAddress as `0x${string}`,
        abi: AutoExerciseABI,
        functionName: "autoExercise",
        chain: walletClient.chain,
        account: walletClient.account as Account,
        args: [
          option.market as `0x${string}`,
          BigInt(option.tokenId),
          executorFee,
          {
            optionId: BigInt(
              profitabilityResult.exerciseParams?.optionId || "0"
            ),
            swapper: profitabilityResult.exerciseParams?.swapper || [],
            swapData: (profitabilityResult.exerciseParams?.swapData ||
              []) as readonly `0x${string}`[],
            liquidityToExercise:
              profitabilityResult.exerciseParams?.liquidityToExercise.map(
                (liquidity) => BigInt(liquidity || "0")
              ) || [],
          },
        ],
      });

      this.logger.info(`Auto-exercise transaction submitted`, {
        optionId: option.tokenId,
        hash,
        params: profitabilityResult.exerciseParams,
      });
    } catch (error) {
      this.logger.error(
        `Error handling expiring option ${option.tokenId}:`,
        error
      );
      this.logger.error("Failed option details:", {
        option,
        chainId: option.chainId,
        market: option.market,
      });
    }
  }

  private async handleExpiredOption(option: Option) {
    this.logger.info(`Handling expired option ${option.tokenId}`, { option });

    try {
      const { publicClient, walletClient } = this.createClientsForChain(
        option.chainId
      );

      const poolFee = (await publicClient.readContract({
        address: option.internalOptions[0].pool as `0x${string}`,
        abi: UniswapV3PoolABI,
        functionName: "fee",
      })) as number;
      this.logger.info(`Pool fee: ${poolFee}`);

      // Calculate liquidity to settle for each internal option
      const liquidityToSettle: bigint[] = option.internalOptions.map(
        (internalOption) => {
          const liquidityAvailable =
            BigInt(internalOption.liquidityAtOpen) -
            BigInt(internalOption.liquidityExercised) -
            BigInt(internalOption.liquiditySettled);
          return liquidityAvailable;
        }
      );

      // Prepare swap data for each position
      const swapData = option.internalOptions.map((internalOption) => {
        return encodePacked(
          ["uint24", "uint256"],
          [
            poolFee,
            BigInt(0), // minAmount set to 0
          ]
        );
      });

      // Get swapper address from environment
      const swapperAddress = this.chainConfigService.getSwapRouterSwapper(
        option.chainId
      );
      const swapperAddresses = Array(option.opTickArrayLen).fill(
        swapperAddress
      );

      // // Prepare settlement parameters
      const settlementParams: SettleOptionParams = {
        optionId: BigInt(option.tokenId),
        swapper: swapperAddresses as readonly `0x${string}`[],
        swapData: swapData as readonly `0x${string}`[],
        liquidityToSettle: liquidityToSettle as readonly bigint[],
      };

      this.logger.info("Attempting to settle option with params:", {
        optionId: option.tokenId,
        liquidityToSettle,
        swapperAddresses,
      });

      // Execute settlement transaction
      const hash = await walletClient.writeContract({
        address: option.market as `0x${string}`,
        abi: OptionMarketABI,
        functionName: "settleOption",
        chain: walletClient.chain,
        account: walletClient.account as Account,
        args: [
          {
            optionId: settlementParams.optionId,
            swapper: settlementParams.swapper,
            swapData: settlementParams.swapData,
            liquidityToSettle: settlementParams.liquidityToSettle,
          },
        ],
      });

      this.logger.info(`Settlement transaction submitted`, {
        optionId: option.tokenId,
        hash,
        params: settlementParams,
      });
    } catch (error) {
      this.logger.error(
        `Error handlin expired options ${option.tokenId}:`,
        error
      );
      this.logger.error("Failed option details:", {
        option,
        chainId: option.chainId,
        market: option.market,
      });
    }
  }

  // Method to clean up expired cache entries
  private cleanupCache() {
    // Clean up the profitability calculator's cache
    this.profitabilityCalculator.cleanupCache();
  }

  // Public method to calculate option profitability (delegates to the profitability calculator)
  async calculateOptionProfitability(
    request: GetRatesRequest
  ): Promise<GetRatesResponse> {
    return this.profitabilityCalculator.calculateOptionProfitability(request);
  }
}
