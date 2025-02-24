# Exercise & Settlement Engine Specification

## System Overview

The engine monitors and manages options across DopexV2 Option Markets, automatically exercising profitable options near expiry and settling expired options. It integrates with AutoExerciseTimeBased, OpenSettlement, and Swapper Contracts.

## Core Components

### 1. Option Data Indexer

#### Contract Monitoring through Backend

- Monitor all DopexV2OptionMarketV2 contracts
-
- Track option data through `opData()` and `opTickMap()` functions
-
- Reference implementation:

```42:48:src/interfaces/IOptionMarket.sol
    struct OptionData {
        uint256 opTickArrayLen;
        int24 tickLower;
        int24 tickUpper;
        uint256 expiry;
        bool isCall;
    }
```

### 2. Price Feed Service

1. getCurrentPrice() from primePool.

### 3. Auto Exercise Engine

#### Exercise Window Check

- Monitor options within 5 minutes of expiry (configurable)

```
    function autoExercise(
        IOptionMarket market,
        uint256 tokenId,
        uint256 executorFee,
        IOptionMarket.ExerciseOptionParams calldata _params
) external onlyRole(EXECUTOR_ROLE) {
        IOptionMarket.OptionData memory opData = market.opData(tokenId);

        if (opData.expiry < block.timestamp) {
            revert AutoExerciseOneMin__AlreadyExpired();
        }

        if (opData.expiry - block.timestamp > timeToSettle) {
            revert AutoExerciseOneMin__TooSoon();
        }

        if (executorFee > MAX_EXECUTOR_FEE) {
            revert AutoExerciseOneMin__GreedyExecutor();
        }
```

### 4. Settlement Engine

#### Settlement Window Check

- Monitor expired options

- Reference implementation:

```28:53:src/periphery/OpenSettlement.sol
    function openSettle(IOptionMarket market, uint256 tokenId, IOptionMarket.SettleOptionParams calldata _params)
        public
    {
        IOptionMarket.OptionData memory opData = market.opData(tokenId);

        if (opData.expiry >= block.timestamp) {
            revert OpenSettlement__NotExpired();
        }

        if (block.timestamp - opData.expiry <= timeToSettle) {
            revert OpenSettlement__TooSoonOpenSettle();
        }

        market.settleOption(_params);

        uint256 callAssetBalance = IERC20(market.callAsset()).balanceOf(address(this));
        uint256 putAssetBalance = IERC20(market.putAsset()).balanceOf(address(this));

        if (callAssetBalance > 0) {
            IERC20(market.callAsset()).safeTransfer(msg.sender, callAssetBalance);
        }

        if (putAssetBalance > 0) {
            IERC20(market.putAsset()).safeTransfer(msg.sender, putAssetBalance);
        }
    }
```

### 5. Swapper Integration

```
function onSwapReceived(address _tokenIn, address _tokenOut, uint256 _amountIn, bytes memory _swapData)
        external
        returns (uint256 amountOut)
    {
        (uint24 fee, uint256 amountOutMinimum) = abi.decode(_swapData, (uint24, uint256));

        IERC20(_tokenIn).safeIncreaseAllowance(address(sr), _amountIn);

        amountOut = sr.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: _tokenIn,
                tokenOut: _tokenOut,
                fee: fee,
                recipient: msg.sender,
                deadline: block.timestamp,
                amountIn: _amountIn,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            })
        );
    }
```

6. Other Components

- Health Check (RPC, Backend, options exercisable but not exercised, options settlelable but not settled)
- Data Dashboard (options exercised, options settled, profit earned)
