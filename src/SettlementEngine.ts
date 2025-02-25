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
import { Option } from "./types/Option";
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
  private readonly privateKey: string;
  private readonly logger: winston.Logger;
  private isRunning: boolean = false;
  private readonly chainConfigs: Map<number, Chain> = new Map();

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
  }

  async start() {
    if (this.isRunning) {
      this.logger.warn("Settlement engine is already running");
      return;
    }

    this.isRunning = true;
    this.logger.info("Starting settlement engine");

    while (this.isRunning) {
      try {
        await this.processExpiringOptions();
        await this.processExpiredOptions();
        await new Promise((resolve) => setTimeout(resolve, 10000)); // Poll every 10 seconds
      } catch (error) {
        this.logger.error("Error in main loop:", error);
      }
    }
  }

  stop() {
    this.isRunning = false;
    this.logger.info("Stopping settlement engine");
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

      // Get prime pool address and then its fee
      const primePool = await publicClient.readContract({
        address: option.market as `0x${string}`,
        abi: OptionMarketABI,
        functionName: "primePool",
      });

      // Get call and put assets and pool data in a single multicall
      const multicallResult = await publicClient.multicall({
        contracts: [
          {
            address: option.market as `0x${string}`,
            abi: OptionMarketABI,
            functionName: "callAsset",
          },
          {
            address: option.market as `0x${string}`,
            abi: OptionMarketABI,
            functionName: "putAsset",
          },
          {
            address: primePool as `0x${string}`,
            abi: UniswapV3PoolABI,
            functionName: "token0",
          },
          {
            address: primePool as `0x${string}`,
            abi: UniswapV3PoolABI,
            functionName: "token1",
          },
          {
            address: primePool as `0x${string}`,
            abi: UniswapV3PoolABI,
            functionName: "fee",
          },
          {
            address: primePool as `0x${string}`,
            abi: UniswapV3PoolABI,
            functionName: "slot0",
          },
          {
            address: primePool as `0x${string}`,
            abi: UniswapV3PoolABI,
            functionName: "liquidity",
          },
        ],
      });

      if (multicallResult.some((result) => result.status === "failure")) {
        throw new Error("Failed to fetch pool data");
      }

      const callAsset = multicallResult[0].result as `0x${string}`;
      const putAsset = multicallResult[1].result as `0x${string}`;
      const token0 = multicallResult[2].result as `0x${string}`;
      const token1 = multicallResult[3].result as `0x${string}`;
      const poolFee = multicallResult[4].result as number;
      const slot0 = multicallResult[5].result as [
        bigint,
        number,
        number,
        number,
        number,
        number,
        boolean
      ];
      const liquidity = multicallResult[6].result as bigint;

      // Determine which token is which in the pool
      const isCall = option.isCall;
      const isAmount0 = isCall ? token0 === callAsset : token0 === putAsset;

      // Determine assetToUse and assetToGet
      const assetToUse = isCall ? callAsset : putAsset;
      const assetToGet = isCall ? putAsset : callAsset;

      // Calculate profitability for each internal option
      let totalProfit = BigInt(0);
      const liquidityToExercise: bigint[] = [];
      const profitabilityDetails: any[] = [];

      for (let i = 0; i < option.internalOptions.length; i++) {
        const internalOption = option.internalOptions[i];

        // Calculate available liquidity
        const liquidityAvailable = BigInt(internalOption.liquidityAtLive);

        if (liquidityAvailable <= BigInt(0)) {
          liquidityToExercise.push(BigInt(0));
          continue;
        }

        // Get tick lower and tick upper from the internal option
        const tickLower = internalOption.tickLower;
        const tickUpper = internalOption.tickUpper;

        // Get sqrt price for ticks
        const sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(Number(tickLower));
        const sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(Number(tickUpper));

        this.logger.info("Sqrt price calculations", {
          tickLower,
          tickUpper,
          sqrtRatioAX96: sqrtRatioAX96.toString(),
          sqrtRatioBX96: sqrtRatioBX96.toString(),
          liquidityAvailable: liquidityAvailable.toString(),
        });

        // Calculate amounts using SqrtPriceMath
        const amount0 = SqrtPriceMath.getAmount0Delta(
          sqrtRatioAX96,
          sqrtRatioBX96,
          JSBI.BigInt(liquidityAvailable.toString()),
          true // round up
        );
        const amount1 = SqrtPriceMath.getAmount1Delta(
          sqrtRatioAX96,
          sqrtRatioBX96,
          JSBI.BigInt(liquidityAvailable.toString()),
          true // round up
        );

        this.logger.info("Raw amounts", {
          amount0: amount0.toString(),
          amount1: amount1.toString(),
        });

        let amountLocked: JSBI;
        let amountToRefill: JSBI;

        if (isAmount0) {
          amountLocked = amount0;
          amountToRefill = amount1;
        } else {
          amountLocked = amount1;
          amountToRefill = amount0;
        }

        this.logger.info("Final amounts", {
          amountLocked: amountLocked.toString(),
          amountToRefill: amountToRefill.toString(),
          isAmount0,
        });

        // Get quoter address from chain config
        const quoterAddress = this.chainConfigService.getQuoterAddress(
          option.chainId
        );

        // Convert JSBI to native BigInt for the contract call
        const amountToSwapBigInt = BigInt(amountLocked.toString());

        // Use Quoter contract to estimate swap output
        const { result } = (await publicClient.simulateContract({
          address: quoterAddress as `0x${string}`,
          abi: quoterABI,
          functionName: "quoteExactInputSingle",
          args: [
            {
              tokenIn: assetToUse,
              tokenOut: assetToGet,
              amountIn: amountToSwapBigInt,
              fee: poolFee,
              sqrtPriceLimitX96: BigInt(0), // no limit
            },
          ],
        })) as { result: [bigint, bigint, number, bigint] };

        // Extract amountOut from the result tuple
        const quotedAmountOut = result[0];
        this.logger.info("Quoted amount out", {
          quotedAmountOut: quotedAmountOut.toString(),
          sqrtPriceAfter: result[1].toString(),
          ticksCrossed: result[2].toString(),
          gasEstimate: result[3].toString(),
          tokenIn: assetToUse,
          tokenOut: assetToGet,
          amountIn: amountToSwapBigInt,
          fee: poolFee,
        });

        const profit = quotedAmountOut - BigInt(amountToRefill.toString());

        profitabilityDetails.push({
          index: i,
          liquidityAvailable: liquidityAvailable.toString(),
          amountLocked: amountLocked.toString(),
          quotedAmountOut: (quotedAmountOut as bigint).toString(),
          amountToRefill: amountToRefill.toString(),
          profit: profit.toString(),
          isProfitable: profit > BigInt(0),
        });

        // Add to total profit only if profitable
        if (profit > BigInt(0)) {
          totalProfit += profit;
        }

        // Only exercise if profitable
        liquidityToExercise.push(
          profit > BigInt(0) ? liquidityAvailable : BigInt(0)
        );
      }

      // Log profitability details
      this.logger.info(`Profitability analysis for option ${option.tokenId}`, {
        totalProfit: totalProfit.toString(),
        isProfitable: totalProfit > BigInt(0),
        details: profitabilityDetails,
      });

      // Check if there's any liquidity to exercise
      const totalLiquidityToExercise = liquidityToExercise.reduce(
        (sum, liquidity) => sum + liquidity,
        BigInt(0)
      );

      if (totalLiquidityToExercise === BigInt(0)) {
        this.logger.info(
          `No profitable liquidity to exercise for option ${option.tokenId}`
        );
        return;
      }

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

      const autoExerciseAddress = this.chainConfigService.getAutoExercise(
        option.chainId
      );
      const swapRouterSwapperAddress =
        this.chainConfigService.getSwapRouterSwapper(option.chainId);

      // Get swapper address from environment
      const swapperAddresses = Array(option.opTickArrayLen).fill(
        swapRouterSwapperAddress
      );

      // // Prepare exercise parameters
      const exerciseParams = {
        optionId: BigInt(option.tokenId),
        swapper: swapperAddresses as readonly `0x${string}`[],
        swapData: swapData as readonly `0x${string}`[],
        liquidityToExercise: liquidityToExercise as readonly bigint[],
      };

      this.logger.info("Attempting to exercise option with params:", {
        optionId: option.tokenId,
        liquidityToExercise,
        swapperAddresses,
        totalProfit: totalProfit.toString(),
      });

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
          exerciseParams,
        ],
      });

      this.logger.info(`Auto-exercise transaction submitted`, {
        optionId: option.tokenId,
        hash,
        params: exerciseParams,
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
      // Get prime pool address and then its fee
      const primePool = await publicClient.readContract({
        address: option.market as `0x${string}`,
        abi: OptionMarketABI,
        functionName: "primePool",
      });

      const poolFee = await publicClient.readContract({
        address: primePool,
        abi: UniswapV3PoolABI,
        functionName: "fee",
      });

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
}
