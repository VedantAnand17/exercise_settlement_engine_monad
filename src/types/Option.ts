export interface InternalOption {
  handler: string;
  pool: string;
  hook: string;
  liquidityAtOpen: string;
  liquidityExercised: string;
  liquiditySettled: string;
  liquidityAtLive: string;
  tickLower: string;
  tickUpper: string;
  strike: string;
  index: string;
}

export interface Option {
  tokenId: string;
  market: string;
  owner: string;
  createdAt: number;
  expiry: number;
  isCall: boolean;
  opTickArrayLen: number;
  chainId: number;
  exerciseDelegate?: boolean;
  internalOptions: InternalOption[];
}

export interface OptionsResponse {
  options: Option[];
}

export interface GetRatesRequestInternalOption {
  tickLower: string;
  tickUpper: string;
  liquidity: string;
}

export interface GetRatesRequest {
  market: string;
  pool: string;
  tokenId: string;
  isCall: boolean;
  chainId: number;
  internalOptions: GetRatesRequestInternalOption[];
}

export interface ProfitabilityResult {
  index: number;
  liquidityAvailable: string;
  amountLocked: string;
  quotedAmountOut: string;
  amountToRefill: string;
  profit: string;
  isProfitable: boolean;
}

export interface GetRatesResponse {
  tokenId: string;
  totalProfit: string;
  isProfitable: boolean;
  details: ProfitabilityResult[];
  exerciseParams?: {
    optionId: string;
    swapper: `0x${string}`[];
    swapData: `0x${string}`[];
    liquidityToExercise: string[];
  };
}
