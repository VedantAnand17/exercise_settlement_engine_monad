import { createPublicClient, http, createWalletClient, parseEther, formatEther, type PublicClient, type WalletClient, Chain, defineChain, encodeFunctionData, encodeDeployData, encodePacked, Account } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, optimism, arbitrum } from 'viem/chains';
import { OptionsService } from './services/OptionsService';
import { ChainConfigService } from './services/ChainConfigService';
import { Option } from './types/Option';
import winston from 'winston';
import { AutoExerciseABI } from './abis/AutoExerciseABI';
import { SwapRouterSwapperABI } from './abis/SwapRouterSwapperABI';
import { OptionMarketABI } from './abis/OptionMarketABI';
import { UniswapV3PoolABI } from './abis/UniswapV3PoolABI';

// opData returns [opTickArrayLen, tickLower, tickUpper, expiry, isCall]
type OptionData = readonly [bigint, number, number, bigint, boolean];

// settleOption parameters
interface SettleOptionParams {
  optionId: bigint;
  swapper: readonly `0x${string}`[];
  swapData: readonly `0x${string}`[];
  liquidityToSettle: readonly bigint[];
}

export class SettlementEngine {
  private readonly optionsService: OptionsService;
  private readonly chainConfigService: ChainConfigService;
  private readonly privateKey: string;
  private readonly logger: winston.Logger;
  private isRunning: boolean = false;
  private readonly chainConfigs: Map<number, Chain> = new Map();

  constructor(
    privateKey: string,
    chainConfigService: ChainConfigService,
    optionsService: OptionsService
  ) {
    this.optionsService = optionsService;
    this.chainConfigService = chainConfigService;
    this.privateKey = privateKey;

    // Initialize logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'settlement-engine.log' })
      ]
    });
  }

  async start() {
    if (this.isRunning) {
      this.logger.warn('Settlement engine is already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting settlement engine');

    while (this.isRunning) {
      try {
        await this.processExpiringOptions();
        await this.processExpiredOptions();
        await new Promise(resolve => setTimeout(resolve, 10000)); // Poll every 10 seconds
      } catch (error) {
        this.logger.error('Error in main loop:', error);
      }
    }
  }

  stop() {
    this.isRunning = false;
    this.logger.info('Stopping settlement engine');
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
          name: 'Native Token',
          symbol: 'ETH',
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

  private createClientsForChain(chainId: number): { publicClient: PublicClient; walletClient: WalletClient } {
    const chain = this.getChainConfig(chainId);
    const rpcUrl = this.chainConfigService.getRpcUrl(chainId);

    // Create public client
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl)
    }) as PublicClient;

    // Create wallet client
    const account = privateKeyToAccount(this.privateKey as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl)
    }) as WalletClient;

    return { publicClient, walletClient };
  }

  private async processExpiringOptions() {
    try {
      const { options } = await this.optionsService.getExpiringOptions();
      this.logger.info(`Processing ${options.length} expiring options`);

      for (const option of options) {
        await this.handleExpiringOption(option);
      }
    } catch (error) {
      this.logger.error('Error processing expiring options:', error);
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
      this.logger.error('Error processing expired options:', error);
    }
  }

  private async handleExpiringOption(option: Option) {
    this.logger.info(`Handling expiring option ${option.tokenId}`, { option });
    
    try {
      const { publicClient, walletClient } = this.createClientsForChain(option.chainId);
      const autoExerciseAddress = this.chainConfigService.getAutoExercise(option.chainId);
      const swapRouterSwapperAddress = this.chainConfigService.getSwapRouterSwapper(option.chainId);

      // TODO: Implement auto-exercise logic based on profitability check
      // 1. Check if option is profitable by getting current price from the market
      // 2. If profitable:
      //    - Prepare exercise parameters
      //    - Call autoExercise contract with appropriate parameters
      //    - Handle any swaps needed through SwapRouterSwapper
      // 3. Log the result of the exercise attempt
    } catch (error) {
      this.logger.error(`Error handling expiring option ${option.tokenId}:`, error);
    }
  }

  private async handleExpiredOption(option: Option) {
    this.logger.info(`Handling expired option ${option.tokenId}`, { option });
    
    try {
      const { publicClient, walletClient } = this.createClientsForChain(option.chainId);
      // Get prime pool address and then its fee
      const primePool = await publicClient.readContract({
        address: option.market as `0x${string}`,
        abi: OptionMarketABI,
        functionName: 'primePool'
      });

      const poolFee = await publicClient.readContract({
        address: primePool,
        abi: UniswapV3PoolABI,
        functionName: 'fee'
      });

      // Calculate liquidity to settle for each internal option
      const liquidityToSettle: bigint[] = option.internalOptions.map(internalOption => {
        const liquidityAvailable = BigInt(internalOption.liquidityAtOpen) - 
                                 BigInt(internalOption.liquidityExercised) - 
                                 BigInt(internalOption.liquiditySettled);
        return liquidityAvailable;
      });

      // Prepare swap data for each position
      const swapData = option.internalOptions.map(() => {
        return encodePacked(['uint24', 'uint256'], [
          poolFee,
          BigInt(0)     // minAmount set to 0
        ]);
      });
      console.log(swapData);

      // Get swapper address from environment
      const swapperAddress = this.chainConfigService.getSwapRouterSwapper(option.chainId);
      const swapperAddresses = Array(option.opTickArrayLen).fill(swapperAddress);
      
      
      // // Prepare settlement parameters
      const settlementParams: SettleOptionParams = {
        optionId: BigInt(option.tokenId),
        swapper: swapperAddresses as readonly `0x${string}`[],
        swapData: swapData as readonly `0x${string}`[],
        liquidityToSettle: liquidityToSettle as readonly bigint[]
      };

      this.logger.info('Attempting to settle option with params:', {
        optionId: option.tokenId,
        liquidityToSettle,
        swapperAddresses,
      });

      console.log(settlementParams);
      const settleData = encodePacked(['uint256', 'address[]', 'bytes[]', 'uint256[]'], [
        settlementParams.optionId,
        settlementParams.swapper,
        settlementParams.swapData,
        settlementParams.liquidityToSettle
      ]);

      // // Execute settlement transaction
      const hash = await walletClient.writeContract({
        address: option.market as `0x${string}`,
        abi: OptionMarketABI,
        chain: null,
        account: walletClient.account as Account,
        functionName: 'settleOption',
        args: [{
          optionId: settlementParams.optionId,
          swapper: settlementParams.swapper,
          swapData,
          liquidityToSettle
        }]
      });
      console.log('hash',hash);


      // this.logger.info(`Settlement transaction submitted`, {
      //   optionId: option.tokenId,
      //   hash,
      //   params: settlementParams
      // });

    } catch (error) {
      this.logger.error(`Error handling expired option ${option.tokenId}:`, error);
      this.logger.error('Failed option details:', {
        option,
        chainId: option.chainId,
        market: option.market
      });
    }
  }
} 