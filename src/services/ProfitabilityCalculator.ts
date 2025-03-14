import {
  createPublicClient,
  http,
  encodePacked,
  type PublicClient,
  Chain,
  defineChain,
} from "viem";
import { TickMath, SqrtPriceMath } from "@uniswap/v3-sdk";
import JSBI from "jsbi";
import winston from "winston";
import { quoterABI } from "../abis/QuoterV2ABI";
import { UniswapV3PoolABI } from "../abis/UniswapV3PoolABI";
import { OptionMarketABI } from "../abis/OptionMarketABI";
import {
  GetRatesRequest,
  GetRatesResponse,
  ProfitabilityResult,
} from "../types/Option";
import { ChainConfigService } from "./ChainConfigService";

export interface PoolMarketInfo {
  poolFee: number;
  callAsset: `0x${string}`;
  putAsset: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
  primePool?: `0x${string}`;
}

export class ProfitabilityCalculator {
  private readonly chainConfigService: ChainConfigService;
  private readonly logger: winston.Logger;
  private readonly chainConfigs: Map<number, Chain> = new Map();
  private readonly profitabilityCache: Map<
    string,
    { timestamp: number; result: GetRatesResponse }
  > = new Map();
  private readonly CACHE_TTL_MS = 5000; // 5 seconds cache TTL
  // Cache for pool and market information
  private readonly poolMarketInfoCache: Map<string, PoolMarketInfo> = new Map();

  constructor(chainConfigService: ChainConfigService, logger: winston.Logger) {
    this.chainConfigService = chainConfigService;
    this.logger = logger;
  }

  // Helper method to generate a cache key for profitability requests
  private generateProfitabilityCacheKey(request: GetRatesRequest): string {
    // Create a deterministic cache key based on the request properties
    return `${request.chainId}-${request.market}-${request.pool}-${
      request.tokenId
    }-${request.isCall}-${JSON.stringify(request.internalOptions)}`;
  }

  // Helper method to check if a cached result is still valid
  private isCacheValid(timestamp: number): boolean {
    return Date.now() - timestamp < this.CACHE_TTL_MS;
  }

  // Helper method to generate a cache key for pool and market information
  private generatePoolMarketCacheKey(
    chainId: number,
    market: string,
    pool: string
  ): string {
    return `${chainId}-${market}-${pool}`;
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

  private createPublicClientForChain(chainId: number): PublicClient {
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
    return createPublicClient({
      chain,
      transport: http(rpcUrl),
    }) as PublicClient;
  }

  // Helper method to get cached pool and market information
  private async getPoolMarketInfo(
    chainId: number,
    market: string,
    pool: string,
    publicClient: PublicClient
  ): Promise<PoolMarketInfo> {
    const cacheKey = this.generatePoolMarketCacheKey(chainId, market, pool);
    const cachedInfo = this.poolMarketInfoCache.get(cacheKey);

    if (cachedInfo) {
      this.logger.debug(`Using cached pool/market info for ${cacheKey}`);
      return cachedInfo;
    }

    this.logger.info(`Fetching pool/market info for ${cacheKey}`);

    // Fetch the prime pool if needed
    let primePool: `0x${string}` | undefined;
    if (market === pool) {
      // If market and pool are the same, we don't need to fetch the prime pool
      primePool = pool as `0x${string}`;
    } else {
      // Otherwise, fetch the prime pool from the market
      primePool = (await publicClient.readContract({
        address: market as `0x${string}`,
        abi: OptionMarketABI,
        functionName: "primePool",
      })) as `0x${string}`;
    }

    // Get call and put assets and pool data in a single multicall
    const multicallResult = await publicClient.multicall({
      contracts: [
        {
          address: pool as `0x${string}`,
          abi: UniswapV3PoolABI,
          functionName: "fee",
        },
        {
          address: market as `0x${string}`,
          abi: OptionMarketABI,
          functionName: "callAsset",
        },
        {
          address: market as `0x${string}`,
          abi: OptionMarketABI,
          functionName: "putAsset",
        },
        {
          address: pool as `0x${string}`,
          abi: UniswapV3PoolABI,
          functionName: "token0",
        },
        {
          address: pool as `0x${string}`,
          abi: UniswapV3PoolABI,
          functionName: "token1",
        },
      ],
    });

    if (multicallResult.some((result) => result.status === "failure")) {
      throw new Error("Failed to fetch pool data");
    }

    const poolFee = multicallResult[0].result as number;
    const callAsset = multicallResult[1].result as `0x${string}`;
    const putAsset = multicallResult[2].result as `0x${string}`;
    const token0 = multicallResult[3].result as `0x${string}`;
    const token1 = multicallResult[4].result as `0x${string}`;

    const info = {
      poolFee,
      callAsset,
      putAsset,
      token0,
      token1,
      primePool,
    };

    // Cache the result
    this.poolMarketInfoCache.set(cacheKey, info);

    return info;
  }

  async calculateOptionProfitability(
    request: GetRatesRequest
  ): Promise<GetRatesResponse> {
    const startTime = Date.now();
    this.logger.info(
      `Calculating profitability for option ${request.tokenId}`,
      { request }
    );

    // Check cache first
    const cacheKey = this.generateProfitabilityCacheKey(request);
    const cachedResult = this.profitabilityCache.get(cacheKey);

    if (cachedResult && this.isCacheValid(cachedResult.timestamp)) {
      this.logger.info(
        `Using cached profitability result for option ${request.tokenId}`
      );
      return cachedResult.result;
    }

    try {
      const publicClient = this.createPublicClientForChain(request.chainId);

      // Get pool and market information from cache or fetch it
      const poolMarketInfo = await this.getPoolMarketInfo(
        request.chainId,
        request.market,
        request.pool,
        publicClient
      );

      this.logger.info(`Time after getting pool info ${request.tokenId}`, {
        time: Date.now() - startTime,
      });

      const { poolFee, callAsset, putAsset, token0, token1 } = poolMarketInfo;

      // Determine which token is which in the pool
      const isCall = request.isCall;
      const isAmount0 = isCall ? token0 === callAsset : token0 === putAsset;

      // Determine assetToUse and assetToGet
      const assetToUse = isCall ? callAsset : putAsset;
      const assetToGet = isCall ? putAsset : callAsset;

      // Get quoter address from chain config
      const quoterAddress = this.chainConfigService.getQuoterAddress(
        request.chainId
      );

      // Prepare batch of quote requests for all internal options
      const quoteRequests = [];
      const internalOptionsData = [];

      for (let i = 0; i < request.internalOptions.length; i++) {
        const internalOption = request.internalOptions[i];
        const liquidityAvailable = BigInt(internalOption.liquidity);

        if (liquidityAvailable <= BigInt(0)) {
          internalOptionsData.push({
            index: i,
            liquidityAvailable: BigInt(0),
            amountLocked: BigInt(0),
            amountToRefill: BigInt(0),
            skipQuote: true,
          });
          continue;
        }

        // Get tick lower and tick upper from the internal option
        const tickLower = parseInt(internalOption.tickLower);
        const tickUpper = parseInt(internalOption.tickUpper);

        // Get sqrt price for ticks
        const sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(Number(tickLower));
        const sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(Number(tickUpper));

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

        let amountLocked: JSBI;
        let amountToRefill: JSBI;

        if (isAmount0) {
          amountLocked = amount0;
          amountToRefill = amount1;
        } else {
          amountLocked = amount1;
          amountToRefill = amount0;
        }

        // Convert JSBI to native BigInt for the contract call
        const amountToSwapBigInt = BigInt(amountLocked.toString());
        const amountToRefillBigInt = BigInt(amountToRefill.toString());

        // Add to the quote requests array
        quoteRequests.push({
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
        });

        internalOptionsData.push({
          index: i,
          liquidityAvailable,
          amountLocked: amountToSwapBigInt,
          amountToRefill: amountToRefillBigInt,
          skipQuote: false,
        });
      }

      // Execute all quote requests in a single multicall
      this.logger.info(`Time before multi call 2 ${request.tokenId}`, {
        time: Date.now() - startTime,
      });
      const quoteResults =
        quoteRequests.length > 0
          ? await publicClient.multicall({
              contracts: quoteRequests as readonly {
                address: `0x${string}`;
                abi: any;
                functionName: string;
                args?: readonly unknown[];
              }[],
            })
          : [];

      this.logger.info(`Time after multi call 2 ${request.tokenId}`, {
        time: Date.now() - startTime,
      });

      // Process results and calculate profitability
      let totalProfit = BigInt(0);
      const profitabilityDetails: ProfitabilityResult[] = [];
      let quoteIndex = 0;

      for (const optionData of internalOptionsData) {
        if (optionData.skipQuote) {
          profitabilityDetails.push({
            index: optionData.index,
            liquidityAvailable: "0",
            amountLocked: "0",
            quotedAmountOut: "0",
            amountToRefill: "0",
            profit: "0",
            isProfitable: false,
          });
          continue;
        }

        const quoteResult = quoteResults[quoteIndex++];

        if (quoteResult.status === "failure") {
          this.logger.error("Quote request failed", {
            error: quoteResult.error,
            index: optionData.index,
          });

          profitabilityDetails.push({
            index: optionData.index,
            liquidityAvailable: optionData.liquidityAvailable.toString(),
            amountLocked: optionData.amountLocked.toString(),
            quotedAmountOut: "0",
            amountToRefill: optionData.amountToRefill.toString(),
            profit: "0",
            isProfitable: false,
          });
          continue;
        }

        // Extract amountOut from the result tuple
        const result = quoteResult.result as [bigint, bigint, number, bigint];
        const quotedAmountOut = result[0];

        const profit = quotedAmountOut - optionData.amountToRefill;

        profitabilityDetails.push({
          index: optionData.index,
          liquidityAvailable: optionData.liquidityAvailable.toString(),
          amountLocked: optionData.amountLocked.toString(),
          quotedAmountOut: quotedAmountOut.toString(),
          amountToRefill: optionData.amountToRefill.toString(),
          profit: profit.toString(),
          isProfitable: profit > BigInt(0),
        });

        // Add to total profit only if profitable
        if (profit > BigInt(0)) {
          totalProfit += profit;
        }
      }

      // Log summary instead of detailed logs for each option
      this.logger.info(`Profitability analysis for option ${request.tokenId}`, {
        totalProfit: totalProfit.toString(),
        isProfitable: totalProfit > BigInt(0),
        optionCount: request.internalOptions.length,
        profitableCount: profitabilityDetails.filter((d) => d.isProfitable)
          .length,
      });

      // Prepare liquidityToExercise array based on profitability
      const liquidityToExercise = profitabilityDetails.map((detail) => {
        return detail.isProfitable ? detail.liquidityAvailable : "0";
      });

      // Always prepare exercise parameters regardless of profitability

      // Prepare swap data for each position
      let swapData: `0x${string}`[] = [];
      try {
        swapData = request.internalOptions.map(() => {
          return encodePacked(
            ["uint24", "uint256"],
            [
              poolFee,
              BigInt(0), // minAmount set to 0
            ]
          );
        });
      } catch (error) {
        this.logger.error(`Error encoding swap data: ${error}`);
        return {
          tokenId: request.tokenId,
          totalProfit: totalProfit.toString(),
          isProfitable: totalProfit > BigInt(0),
          details: profitabilityDetails,
          exerciseParams: {
            optionId: request.tokenId,
            swapper: [],
            swapData: [] as `0x${string}`[],
            liquidityToExercise: Array(request.internalOptions.length).fill(
              "0"
            ),
          },
        };
      }

      const swapRouterSwapperAddress =
        this.chainConfigService.getSwapRouterSwapper(request.chainId);

      // Check if we have a valid swapper address
      if (!swapRouterSwapperAddress) {
        this.logger.error(
          `No swapper address configured for chain ${request.chainId}`
        );
        return {
          tokenId: request.tokenId,
          totalProfit: totalProfit.toString(),
          isProfitable: totalProfit > BigInt(0),
          details: profitabilityDetails,
          exerciseParams: {
            optionId: request.tokenId,
            swapper: [],
            swapData: [] as `0x${string}`[],
            liquidityToExercise: Array(request.internalOptions.length).fill(
              "0"
            ),
          },
        };
      }

      // Get swapper address from environment
      const swapperAddresses = Array(request.internalOptions.length).fill(
        swapRouterSwapperAddress
      );

      const exerciseParams = {
        optionId: request.tokenId,
        swapper: swapperAddresses.map((addr) => addr as `0x${string}`),
        swapData: swapData as `0x${string}`[],
        liquidityToExercise,
      };

      this.logger.info("Generated exercise parameters:", {
        optionId: request.tokenId,
        liquidityToExercise,
        swapperAddresses,
        totalProfit: totalProfit.toString(),
        isProfitable: totalProfit > BigInt(0),
      });

      // Cache the result before returning
      const result = {
        tokenId: request.tokenId,
        totalProfit: totalProfit.toString(),
        isProfitable: totalProfit > BigInt(0),
        details: profitabilityDetails,
        exerciseParams,
      };

      this.profitabilityCache.set(cacheKey, {
        timestamp: Date.now(),
        result,
      });

      return result;
    } catch (error) {
      this.logger.error(
        `Error calculating profitability for option ${request.tokenId}:`,
        error
      );
      // Return a basic response with empty exercise params
      return {
        tokenId: request.tokenId,
        totalProfit: "0",
        isProfitable: false,
        details: [],
        exerciseParams: {
          optionId: request.tokenId,
          swapper: [],
          swapData: [] as `0x${string}`[],
          liquidityToExercise: request.internalOptions
            ? Array(request.internalOptions.length).fill("0")
            : [],
        },
      };
    }
  }

  // Method to clean up expired cache entries
  cleanupCache() {
    const now = Date.now();
    let expiredCount = 0;

    for (const [key, value] of this.profitabilityCache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL_MS) {
        this.profitabilityCache.delete(key);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      this.logger.info(
        `Cleaned up ${expiredCount} expired cache entries. Profitability cache size: ${this.profitabilityCache.size}`
      );
    }

    // Log pool market info cache size periodically
    this.logger.debug(
      `Pool market info cache size: ${this.poolMarketInfoCache.size}`
    );
  }
}
