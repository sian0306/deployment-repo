// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interface/IWETHHolder.sol";

interface IUniswapV2Factory {
    function createPair(
        address tokenA,
        address tokenB
    ) external returns (address pair);
}

contract CryptoChamps is ERC20, Ownable, Pausable, ReentrancyGuard {
    using ECDSA for bytes32;

    uint256 public constant MAX_PAUSE_DURATION = 6 hours; // Maximum pause time
    uint256 public constant PAUSE_COOLDOWN = 1 hours; // Minimum delay between pauses

    uint256 private pausedAt; // Timestamp when the contract was paused
    uint256 private lastUnpausedAt; // Timestamp when the contract was last unpaused

    uint256 public buyTax = 5; // 5% buy tax
    uint256 public sellTax = 5; // 5% sell tax
    uint256 public liquidityAllocation = 2; // 2% of tax to liquidity
    uint256 public reflectionAllocation = 3; // 3% of tax to reflections
    IWETHHolder _wethHolder;

    address public admin;

    uint256 public minimumHoldingForReflection = 250 * 10 ** 18; // 250,000 tokens
    address public immutable liquidityPool; // Liquidity pool address
    address public immutable wethAddress; // WETH address
    IUniswapV2Router02 public uniswapRouter;

    mapping(address => bool) public isExcludedFromFees;
    mapping(address => uint256) public totalEthReflections;

    uint256 public totalReflectionsAccumulated;

    event LiquidityPoolCreated(address indexed liquidityPool);
    event MinimumHoldingForReflectionUpdated(uint256 tokens);
    event TaxesUpdated(uint256 buyTax, uint256 sellTax);
    event TaxAllocationsUpdated(
        uint256 liquidityAllocation,
        uint256 reflectionAllocation
    );
    event ReflectionsDistributed(uint256 amount);
    event AdminChanged(address indexed oldAdmin, address indexed newAdmin);
    event ReflectionsClaimed(address indexed holder, uint256 amount);
    event RewardClaimed(
        address indexed to,
        uint256 amount,
        address indexed token
    );

    constructor(
        address _uniswapRouter,
        address _admin,
        IWETHHolder _holder
    ) ERC20("Champ", "CCG") Ownable(_msgSender()) {
        require(_uniswapRouter != address(0), "Invalid router address");
        require(_admin != address(0), "Invalid Admin address");

        isExcludedFromFees[_msgSender()] = true;
        isExcludedFromFees[address(0)] = true;
        isExcludedFromFees[address(this)] = true;
        isExcludedFromFees[address(_holder)] = true;
        isExcludedFromFees[_uniswapRouter] = true;

        uniswapRouter = IUniswapV2Router02(_uniswapRouter);
        wethAddress = uniswapRouter.WETH();
        _wethHolder = _holder;
        // Create liquidity pool
        liquidityPool = _createLiquidityPool();
        // Mint initial supply to deployer 2500000
        _mint(_msgSender(), 2500000000 * 10 ** 18); //TODO::2.5B
        admin = _admin;
        emit LiquidityPoolCreated(liquidityPool);
    }

    function changeAdmin(address _addr) external onlyOwner {
        require(_addr != address(0), "Zero address");
        emit AdminChanged(admin, _addr);
        admin = _addr;
    }

    function changeMinimumHoldingForReflection(
        uint256 _tokens
    ) external onlyOwner {
        require(_tokens > 0, "Minimum token value must be higher than 0");
        minimumHoldingForReflection = _tokens;
        emit MinimumHoldingForReflectionUpdated(_tokens);
    }

    function _createLiquidityPool() internal returns (address) {
        IUniswapV2Factory factory = IUniswapV2Factory(uniswapRouter.factory());
        address pair = factory.createPair(address(this), wethAddress);
        require(pair != address(0), "Failed to create liquidity pool");
        return pair;
    }

    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override transferAllowed {
        bool isLiquidityTransfer = (from == liquidityPool);

        if (isExcludedFromFees[from] || isExcludedFromFees[to]) {
            super._update(from, to, amount);
            return;
        }

        uint256 transactionTax = (to == liquidityPool) ? sellTax : buyTax;
        uint256 taxAmount = (amount * transactionTax) / 100;
        uint256 amountAfterTax = amount - taxAmount;

        if (isLiquidityTransfer) {
            super._update(from, to, amountAfterTax);
            super._update(from, address(this), taxAmount);
            return;
        }

        uint256 liquidityTax = ((taxAmount * liquidityAllocation) /
            transactionTax);
        uint256 reflectionTax = taxAmount - liquidityTax;
        uint256 liquidityHalf = liquidityTax / 2;
        uint256 swapHalf = liquidityTax - liquidityHalf;
        uint256 tokensToSwap = swapHalf + reflectionTax;
        super._update(from, address(this), taxAmount);
        uint256 wethOutFromSwap = _swapTokensForWETH(tokensToSwap);
        uint256 wethUsedInLiquidity = 0;

        // Handle taxes
        if (liquidityTax > 0)
            wethUsedInLiquidity = _addToLiquidity(liquidityHalf);
        if (reflectionTax > 0)
            _distributeReflections(wethOutFromSwap - wethUsedInLiquidity);

        super._update(from, to, amountAfterTax);

        uint256 claimAmountFrom = calculateETHClaimable(from);
        uint256 claimAmountTo = calculateETHClaimable(to);
        if (claimAmountFrom > 0 && from != liquidityPool)
            _claimReflections(from, claimAmountFrom);
        if (claimAmountTo > 0 && to != liquidityPool)
            _claimReflections(to, claimAmountTo);
    }

    function _swapTokensForWETH(
        uint256 tokenAmount
    ) private nonReentrant returns (uint256) {
        (uint256 amountOut, address[] memory path) = _wETHAmountAndPath(
            tokenAmount
        );
        _approve(address(this), address(uniswapRouter), tokenAmount);
        uniswapRouter.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            tokenAmount,
            0,
            path,
            address(_wethHolder),
            block.timestamp
        );
        _wethHolder.transferTokens(uniswapRouter.WETH(), address(this));
        return amountOut;
    }

    function _wETHAmountAndPath(
        uint256 tokenAmount
    ) private view returns (uint256 amountOut, address[] memory path) {
        require(tokenAmount > 0, "Token amount must be greater than zero");

        path = new address[](2);
        path[0] = address(this);
        path[1] = uniswapRouter.WETH();

        uint256[] memory amountsOut = uniswapRouter.getAmountsOut(
            tokenAmount,
            path
        );
        amountOut = amountsOut[1];
        return (amountOut, path);
    }

    function _addToLiquidity(
        uint256 liquidityHalf
    ) private returns (uint256 wethUsed) {
        uint256 wethBalance = IERC20(wethAddress).balanceOf(address(this));
        (uint256 amountOut, ) = _wETHAmountAndPath(liquidityHalf);
        if (wethBalance > 0 && amountOut > 0) {
            _approve(address(this), address(uniswapRouter), liquidityHalf);
            IERC20(wethAddress).approve(address(uniswapRouter), wethBalance);
            (, uint _wethUsedLiquidity, ) = uniswapRouter.addLiquidity(
                address(this),
                wethAddress,
                liquidityHalf,
                amountOut,
                (liquidityHalf * 99) / 100,
                (amountOut * 99) / 100,
                owner(),
                block.timestamp
            );
            wethUsed = _wethUsedLiquidity;
        }
        return wethUsed;
    }

    function _distributeReflections(uint256 amount) private {
        totalReflectionsAccumulated += amount;
        emit ReflectionsDistributed(amount);
    }

    function calculateETHClaimable(
        address holder
    ) public view returns (uint256) {
        uint256 holderBalance = balanceOf(holder);
        if (holderBalance < minimumHoldingForReflection) {
            return 0;
        }
        uint256 totalSupplyExcludingBurned = totalSupply() -
            balanceOf(address(0));
        uint256 reflectionShare = (holderBalance *
            totalReflectionsAccumulated) / totalSupplyExcludingBurned;
        uint256 alreadyClaimed = totalEthReflections[holder];
        return reflectionShare - alreadyClaimed;
    }

    function claimReflections(address _receiver) external nonReentrant {
        require(_receiver != address(0), "Zero Address");
        uint balance = IERC20(address(this)).balanceOf(address(this));
        if (balance > 0) {
            uint256 liquidityTax = ((balance * liquidityAllocation) / 5);
            uint256 reflectionTax = balance - liquidityTax;
            uint256 liquidityHalf = liquidityTax / 2;
            uint256 swapHalf = liquidityTax - liquidityHalf;
            uint256 tokensToSwap = swapHalf + reflectionTax;
            uint256 wethOutFromSwap = _swapTokensForWETH(tokensToSwap);
            uint256 wethUsedInLiquidity = 0;
            // Handle taxes
            if (liquidityTax > 0)
                wethUsedInLiquidity = _addToLiquidity(liquidityHalf);
            if (reflectionTax > 0)
                _distributeReflections(wethOutFromSwap - wethUsedInLiquidity);
        }

        uint256 claimAmount = calculateETHClaimable(_receiver);
        if (claimAmount > 0 && _receiver != liquidityPool)
            _claimReflections(_receiver, claimAmount);
    }

    function _claimReflections(
        address _receiver,
        uint256 claimAmount
    ) private nonReentrant {
        totalEthReflections[_receiver] += claimAmount;
        (bool success, ) = wethAddress.call(
            abi.encodeWithSelector(
                IERC20.transfer.selector,
                _receiver,
                claimAmount
            )
        );
        require(success, "Token transfer failed");
        emit ReflectionsClaimed(_receiver, claimAmount);
    }

    //Function to claim reward points
    function claimRewardPointsWithCHP(
        address _addr,
        uint256 _amount
    ) external nonReentrant {
        require(_msgSender() == admin, "Only Admin Can Call");
        super._update(admin, _addr, _amount);
        emit RewardClaimed(_addr, _amount, address(this));
    }

    function setTaxes(uint256 _buyTax, uint256 _sellTax) external onlyOwner {
        require(_buyTax <= 10 && _sellTax <= 10, "Tax cannot exceed 10%");
        buyTax = _buyTax;
        sellTax = _sellTax;
        emit TaxesUpdated(_buyTax, _sellTax);
    }

    function setTaxAllocations(
        uint256 _liquidityAllocation,
        uint256 _reflectionAllocation
    ) external onlyOwner {
        require(
            _liquidityAllocation + _reflectionAllocation == 5,
            "Allocations must add up to 5%"
        );
        liquidityAllocation = _liquidityAllocation;
        reflectionAllocation = _reflectionAllocation;
        emit TaxAllocationsUpdated(_liquidityAllocation, _reflectionAllocation);
    }

    function pause() public onlyOwner {
        require(!paused(), "Already paused");
        require(
            block.timestamp >= lastUnpausedAt + PAUSE_COOLDOWN,
            "Cooldown active: Cannot pause again yet"
        );

        pausedAt = block.timestamp;
        _pause();
    }

    function unpause() public onlyOwner {
        require(paused(), "Not paused");

        _unpause();
        lastUnpausedAt = block.timestamp;
    }

    function isPauseExpired() public view returns (bool) {
        return paused() && (block.timestamp >= pausedAt + MAX_PAUSE_DURATION);
    }

    modifier transferAllowed() {
        require(
            !paused() || isPauseExpired(),
            "Pausable: paused and time limit not reached"
        );
        if (isPauseExpired()) {
            _unpause(); // Auto unpause if expired
        }
        _;
    }

    function excludeFromFees(
        address account,
        bool excluded
    ) external onlyOwner {
        isExcludedFromFees[account] = excluded;
    }

    fallback() external payable {}

    receive() external payable {}

    event ReceivedTokens(address from, uint256 amount);

    function onERC20Receive(
        address from,
        uint256 amount
    ) external returns (bool) {
        emit ReceivedTokens(from, amount);
        return true;
    }
}
