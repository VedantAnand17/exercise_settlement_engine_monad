export const SwapRouterSwapperABI = [
    {
      "type": "constructor",
      "inputs": [
        { "name": "_sr", "type": "address", "internalType": "address" }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "onSwapReceived",
      "inputs": [
        { "name": "_tokenIn", "type": "address", "internalType": "address" },
        { "name": "_tokenOut", "type": "address", "internalType": "address" },
        { "name": "_amountIn", "type": "uint256", "internalType": "uint256" },
        { "name": "_swapData", "type": "bytes", "internalType": "bytes" }
      ],
      "outputs": [
        { "name": "amountOut", "type": "uint256", "internalType": "uint256" }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "sr",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract ISwapRouter"
        }
      ],
      "stateMutability": "view"
    }
  ] as const;