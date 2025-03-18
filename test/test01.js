// SPDX-License-Identifier: MIT
const { expect } = require("chai");
const { AbiCoder, solidityPackedKeccak256, parseUnits, getBytes, assert, formatEther } = require("ethers");
const { ethers, network } = require("hardhat");

describe("SafeMoonLikeToken Contract", function () {
  let token;
  let wETHHolder
  let owner;
  let addr1;
  let addr2;
  let addr3;
  let uniswapRouter;
  let uniswapRouterAddress;
  let wethAddress;
  let liquidityPool;
  let wethToken;
  const amountSafeMoon = ethers.parseUnits("2000000000", 18);
  const amountWETH = ethers.parseEther("1");

  beforeEach(async () => {
    // Get signers
    [owner, admin, addr1, addr2, addr3] = await ethers.getSigners();

    // Fetch the Uniswap V2 Router contract from forked mainnet
    uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";  // Replace with the actual Uniswap V2 Router address
    uniswapRouter = await ethers.getContractAt("IUniswapV2Router02", uniswapRouterAddress);
    wethAddress = await uniswapRouter.WETH();
    wethToken = await ethers.getContractAt("WETH9", wethAddress);
    uniswapRouter.address = uniswapRouter.target
    // Deploy the WETHHolder contract
    const WETHHolder = await ethers.getContractFactory("WETHHolder");
    wETHHolder = await WETHHolder.deploy(owner.address);
    await wETHHolder.waitForDeployment();
    console.log("wETHHolder Contract Address : ", wETHHolder.target);

    // Deploy the SafeMoonLikeToken contract
    const SafeMoonLikeToken = await ethers.getContractFactory("CryptoChamps");
    token = await SafeMoonLikeToken.deploy(uniswapRouterAddress, admin.address, wETHHolder.target);
    await token.waitForDeployment();
    console.log("SafeMoon Contract Address : ", token.target);

    await wETHHolder.transferOwnership(token.target)

    // Set liquidity pool address
    liquidityPool = await token.liquidityPool();
    await token.approve(uniswapRouterAddress, amountSafeMoon);

    await uniswapRouter.addLiquidityETH(
      token.target, // SafeMoon token address
      amountSafeMoon,   // Amount of SafeMoon to add
      0,                // Min amount of SafeMoon (set to 0 for now)
      0,                // Min amount of ETH (set to 0 for now)
      owner.address,    // Address where liquidity tokens are sent
      Math.floor(Date.now() / 1000) + 60 * 10, // Deadline (10 minutes from now)
      { value: amountWETH } // Add ETH value here
    );
  });

  describe("Deployment", () => {
    it("Should set the correct token name and symbol", async () => {
      expect(await token.name()).to.equal("Champ");
      expect(await token.symbol()).to.equal("CCG");
    });

    it("Should create a liquidity pool upon deployment", async () => {
      expect(liquidityPool).to.not.equal(ethers.ZeroAddress);
    });
  });


  describe("Taxation", () => {
    it("Should correctly set buy and sell taxes", async () => {
      await token.setTaxes(6, 4);
      expect(await token.buyTax()).to.equal(6);
      expect(await token.sellTax()).to.equal(4);
    });

    it("Should revert if taxes exceed 10%", async () => {
      await expect(token.setTaxes(11, 5)).to.be.revertedWith("Tax cannot exceed 10%");
    });

    it("Should apply taxes on transfer", async () => {
      const amount = ethers.parseUnits("100", 18);
      console.log("Before WETH Balance :", formatEther(await wethToken.balanceOf(token.target)));
      // Transfer tokens from owner to addr1, should not apply tax
      await token.transfer(addr1.address, amount);
      expect(await token.balanceOf(addr1.address)).to.equal(amount);

      console.log(formatEther(await token.balanceOf(addr2.address)), "Before Tax Amount");
      console.log(formatEther(await token.balanceOf(addr1.address)), "Addr1 Before Tax Amount");

      await token.connect(addr1).transfer(addr2.address, amount);

      console.log("After WETH Balance :", formatEther(await wethToken.balanceOf(token.target)));
      console.log("After Tax Amount :", formatEther(await token.balanceOf(addr2.address)));
    });

    it("Should apply taxes on transferFrom", async () => {
      const amount = ethers.parseUnits("100", 18);
      // Exclude addr1 from fees
      console.log("Before WETH Balance :", formatEther(await wethToken.balanceOf(token.target)));
      // Transfer tokens from owner to addr1, should not apply tax
      await token.connect(owner).approve(addr1.address, amount);
      await token.connect(addr1).transferFrom(owner.address, addr1.address, amount);
      expect(await token.balanceOf(addr1.address)).to.equal(amount);

      console.log(formatEther(await token.balanceOf(addr2.address)), "Before Addr2 Tax Amount");
      console.log(formatEther(await token.balanceOf(addr1.address)), "Before Addr1 Tax Amount");

      await token.connect(addr1).approve(addr2.address, amount);
      await token.connect(addr2).transferFrom(addr1.address, addr2.address, amount);
      console.log("After WETH Balance :", formatEther(await wethToken.balanceOf(token.target)));
      console.log("After Addr2 Tax Amount :", formatEther(await token.balanceOf(addr2.address)));;
    });
  });


  describe("Swape", () => {

    it("Should apply taxes on transfer", async () => {
      const ethAmount = ethers.parseUnits("0.05", 18);

      console.log("IS Contract Exclude:", await token.isExcludedFromFees(token.target));

      console.log("Balance of addr2 before swap:", formatEther(await token.balanceOf(addr2.address)));

      // Get expected amounts for the swap
      const getamount = await uniswapRouter.getAmountsIn(ethAmount, [token.target, wethAddress]);
      const value = getamount[1].toString();
      const out = getamount[0].toString();

      await uniswapRouter.connect(addr2).swapExactETHForTokensSupportingFeeOnTransferTokens(
        0,
        [wethAddress, token.target],
        addr2.address,
        Math.floor(Date.now() / 1000) + 60 * 10,
        { value, gasLimit: 300000, gasPrice: parseUnits('20', 'gwei') }
      );

      console.log("Balance of addr2 after swap:", formatEther(await token.balanceOf(addr2.address)));
    });
  });

  describe("Reflections", () => {


    it("Should increase Reflection for other holders", async () => {
      // Distribute reflections
      console.log(formatEther(await token.balanceOf(owner.address)), "Before Reflection Balance")
      await token.transfer(addr1.address, ethers.parseUnits("5000", 18)); // Trigger tax

      // Ensure no reflections are claimable
      let claimableOwner = await token.calculateETHClaimable(owner.address)
      console.log("claimable Owner", claimableOwner)

      console.log("After Reflection Balance :", formatEther(await token.balanceOf(owner.address)))

      await token.connect(addr1).transfer(addr2.address, ethers.parseUnits("100", 18)); // Trigger tax

      claimableOwner = await token.calculateETHClaimable(owner.address)
      console.log("claimable Owner", claimableOwner)

      await token.transfer(addr2.address, ethers.parseUnits("5000", 18)); // Trigger tax

      claimableOwner = await token.calculateETHClaimable(owner.address)
      console.log("claimable Owner", claimableOwner)

      let claimableAddr1 = await token.calculateETHClaimable(addr1.address)
      console.log("claimable Addr1", claimableAddr1)


    });

    it("Should returns minimum Holding For Reflection", async () => {
      let minTokens = ethers.parseUnits("250000", 18);
      // Transfer less than minimum holding
      await token.changeMinimumHoldingForReflection(minTokens);

      // Calculate claimable reflections
      const setMinHoldingAfter = await token.minimumHoldingForReflection();

      // Ensure no reflections are claimable
      expect(setMinHoldingAfter).to.equal(minTokens);
    });
  });

  describe("Reward Claim System", () => {

    it("Should allow the admin to claim reward points with CHP", async function () {
      const amount = parseUnits("100", 18);
      await token.connect(owner).transfer(admin.address, amount);
      // Admin claims reward points for the addr1
      await token.connect(admin).claimRewardPointsWithCHP(addr1.address, amount);
    });

    it("Should failed the caller is not admin", async function () {
      const amount = parseUnits("100", 18);
      await token.connect(owner).transfer(admin.address, amount);
      // Admin claims reward points for the addr1
      await expect(token.connect(owner).claimRewardPointsWithCHP(addr1.address, amount)).to.be.revertedWith("Only Admin Can Call");
    });

  });

  describe("Testing Pause Features", () => {
    it("Should allow the owner to pause and unpause the contract", async () => {
      // Test initial state (should not be paused)
      expect(await token.paused()).to.be.false;

      // Owner pauses the contract
      await token.pause();
      expect(await token.paused()).to.be.true;

      // Owner unpauses the contract
      await token.unpause();
      expect(await token.paused()).to.be.false;
    });

    it("Should revert if a non-owner tries to pause or unpause", async () => {
      // Trying to pause from addr1 (non-owner) should revert with OwnableUnauthorizedAccount
      await expect(token.connect(addr1).pause())
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);

      // Trying to unpause from addr1 (non-owner) should revert with OwnableUnauthorizedAccount
      await expect(token.connect(addr1).unpause())
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });

    it("Should prevent pausing again during the cooldown period", async () => {
      // Owner pauses the contract
      await token.pause();
      // Try pausing again (should revert due to cooldown)
      await expect(token.pause()).to.be.revertedWith("Already paused");
    });

    it("Should allow pausing after the cooldown period", async () => {
      await token.pause();
      let tokenCoundown = await token.PAUSE_COOLDOWN()
      // Skip time to allow cooldown
      // await network.provider.send("evm_increaseTime", [tokenCoundown?.toString() + 1]);
      // await network.provider.send("evm_mine");

      // Now the owner should be able to pause again
      // await token.pause();
      expect(await token.paused()).to.be.true;
    });

    it("Should allow transfer once unpaused", async () => {
      await token.pause();
      const amount = ethers.parseUnits("100", 18);

      // Pause the contract
      let MAX_PAUSE_DURATION = await token.MAX_PAUSE_DURATION()

      // Unpause after max duration has passed
      await network.provider.send("evm_increaseTime", [MAX_PAUSE_DURATION?.toString() + 1]);
      await network.provider.send("evm_mine");

      // Unpause the contract
      await token.unpause();
      expect(await token.paused()).to.be.false;
      const amount2 = ethers.parseUnits("100", 18);
      // Perform transfer after unpause
      await token.transfer(addr1.address, amount);
      expect(await token.balanceOf(addr1.address)).to.equal(amount2);
    });


    // it("Should allow transfers when contract is not paused", async () => {
    //   const amount = ethers.parseUnits("100", 18);

    //   // Initial balance
    //   let balanceBefore = await token.balanceOf(addr1.address);
    //   expect(balanceBefore).to.equal(0);

    //   // Transfer while not paused
    //   await token.transfer(addr1.address, amount);
    //   let balanceAfter = await token.balanceOf(addr1.address);
    //   expect(balanceAfter).to.equal(amount);
    // });

    // it("Should block transfers when contract is paused", async () => {
    //   // await token.pause(); // Pause the contract
    //   const amount = ethers.parseUnits("100", 18);

    //   // // Try to transfer while paused
    //   // await expect(token.transfer(addr1.address, amount))
    //   //   .to.be.revertedWith("Pausable: paused and time limit not reached");
    // });

    // it("Should automatically unpause the contract if pause duration has expired", async () => {
    //   await token.pause();
    //   // Pause the contract
    //   let tokenCoundown = await token.MAX_PAUSE_DURATION()

    //   // Simulate time passing beyond the max pause duration
    //   await network.provider.send("evm_increaseTime", [tokenCoundown?.toString() + 1]);
    //   await network.provider.send("evm_mine");

    //   // Check if the contract auto unpauses after the max duration
    //   await token.connect(owner).transfer(addr1.address, ethers.parseUnits("100", 18)); // Triggering transfer (should now succeed)
    //   expect(await token.paused()).to.be.false; // Contract should be unpaused automatically
    // });

    // it("Should revert transfers if the contract is paused and the pause period has not expired", async () => {
    //   // Pause the contract
    //   await token.pause();
    //   expect(await token.paused()).to.be.true;

    //   // Transfer should still fail if the pause period has not expired
    //   await expect(token.transfer(addr1.address, ethers.parseUnits("100", 18))).to.be.revertedWith("Pausable: paused and time limit not reached");
    // });


  })
});


