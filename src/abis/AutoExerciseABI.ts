export const AutoExerciseABI = [
    { "type": "constructor", "inputs": [], "stateMutability": "nonpayable" },
    {
      "type": "function",
      "name": "DEFAULT_ADMIN_ROLE",
      "inputs": [],
      "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "EXECUTOR_FEE_PRECISION",
      "inputs": [],
      "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "EXECUTOR_ROLE",
      "inputs": [],
      "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "MAX_EXECUTOR_FEE",
      "inputs": [],
      "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "autoExercise",
      "inputs": [
        {
          "name": "market",
          "type": "address",
          "internalType": "contract IOptionMarket"
        },
        { "name": "tokenId", "type": "uint256", "internalType": "uint256" },
        { "name": "executorFee", "type": "uint256", "internalType": "uint256" },
        {
          "name": "_params",
          "type": "tuple",
          "internalType": "struct IOptionMarket.ExerciseOptionParams",
          "components": [
            {
              "name": "optionId",
              "type": "uint256",
              "internalType": "uint256"
            },
            {
              "name": "swapper",
              "type": "address[]",
              "internalType": "contract ISwapper[]"
            },
            {
              "name": "swapData",
              "type": "bytes[]",
              "internalType": "bytes[]"
            },
            {
              "name": "liquidityToExercise",
              "type": "uint256[]",
              "internalType": "uint256[]"
            }
          ]
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "feeTo",
      "inputs": [],
      "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "getRoleAdmin",
      "inputs": [
        { "name": "role", "type": "bytes32", "internalType": "bytes32" }
      ],
      "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "grantRole",
      "inputs": [
        { "name": "role", "type": "bytes32", "internalType": "bytes32" },
        { "name": "account", "type": "address", "internalType": "address" }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "hasRole",
      "inputs": [
        { "name": "role", "type": "bytes32", "internalType": "bytes32" },
        { "name": "account", "type": "address", "internalType": "address" }
      ],
      "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "multicall",
      "inputs": [
        { "name": "data", "type": "bytes[]", "internalType": "bytes[]" }
      ],
      "outputs": [
        { "name": "results", "type": "bytes[]", "internalType": "bytes[]" }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "renounceRole",
      "inputs": [
        { "name": "role", "type": "bytes32", "internalType": "bytes32" },
        { "name": "account", "type": "address", "internalType": "address" }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "revokeRole",
      "inputs": [
        { "name": "role", "type": "bytes32", "internalType": "bytes32" },
        { "name": "account", "type": "address", "internalType": "address" }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "supportsInterface",
      "inputs": [
        { "name": "interfaceId", "type": "bytes4", "internalType": "bytes4" }
      ],
      "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "timeToSettle",
      "inputs": [],
      "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "updateFeeTo",
      "inputs": [
        { "name": "_newFeeTo", "type": "address", "internalType": "address" }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "updateTimeForSettle",
      "inputs": [
        { "name": "_newTime", "type": "uint256", "internalType": "uint256" }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "event",
      "name": "RoleAdminChanged",
      "inputs": [
        {
          "name": "role",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        },
        {
          "name": "previousAdminRole",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        },
        {
          "name": "newAdminRole",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "RoleGranted",
      "inputs": [
        {
          "name": "role",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        },
        {
          "name": "account",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "sender",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "RoleRevoked",
      "inputs": [
        {
          "name": "role",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        },
        {
          "name": "account",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "sender",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        }
      ],
      "anonymous": false
    },
    {
      "type": "error",
      "name": "AutoExerciseOneMin__AlreadyExpired",
      "inputs": []
    },
    {
      "type": "error",
      "name": "AutoExerciseOneMin__GreedyExecutor",
      "inputs": []
    },
    { "type": "error", "name": "AutoExerciseOneMin__TooSoon", "inputs": [] }
  ] as const;