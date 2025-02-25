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
