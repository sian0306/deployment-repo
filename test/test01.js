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
  const initialSupply = ethers.parseUnits("1000000000", 18); // 1 Billion tokens
  const buyTax = 5; // 5%
  const sellTax = 5; // 5%
  const liquidityAllocation = 2; // 2%
  const reflectionAllocation = 3; // 3%
  const MINIMUM_HOLDING_FOR_REFLECTION = ethers.parseUnits("250", 18); // 250,000 tokens
  const amountSafeMoon = ethers.parseUnits("2000000000", 18); // Amount of SafeMoon token to add as liquidity
  const amountWETH = ethers.parseEther("1"); // Amount of WETH to add as liquidity
  let not_added = true

  it("Should deploy all smart contracts ", async () => {
    // Get signers
    [owner, admin, addr1, addr2, addr3] = await ethers.getSigners();
    console.log("owner.address : ", owner.address);
    console.log("admin.address : ", admin.address);
    console.log("addr1.address : ", addr1.address);
    console.log("addr2.address : ", addr2.address);
    console.log("addr3.address : ", addr3.address);
    // Fetch the Uniswap V2 Router contract from forked mainnet
    uniswapRouterAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";  // Replace with the actual Uniswap V2 Router address
    uniswapRouter = await ethers.getContractAt("IUniswapV2Router02", uniswapRouterAddress);
    wethAddress = await uniswapRouter.WETH();
    wethToken = await ethers.getContractAt("WETH9", wethAddress);
    uniswapRouter.address = uniswapRouter.target
    // Deploy the SafeMoonLikeToken contract
    const WETHHolder = await ethers.getContractFactory("WETHHolder");
    wETHHolder = await WETHHolder.deploy(owner.address);
    await wETHHolder.waitForDeployment();
    console.log("wETHHolder Contract Address : ", wETHHolder.target);

    const SafeMoonLikeToken = await ethers.getContractFactory("CryptoChamps");
    token = await SafeMoonLikeToken.deploy(uniswapRouterAddress, admin.address, wETHHolder.target);
    await token.waitForDeployment();
    console.log("SafeMoon Contract Address : ", token.target);

    await wETHHolder.transferOwnership(token.target)

    // Set liquidity pool address
    liquidityPool = await token.liquidityPool();
    console.log("liquidityPool", liquidityPool)
    // await token.excludeFromFees(wETHHolder.target, true)
    // await token.excludeFromFees(owner.address, true)
    // await token.excludeFromFees(owner.address, true)
    await token.approve(uniswapRouterAddress, amountSafeMoon);

    console.log("Adding Liquidity in pool")
    await uniswapRouter.addLiquidityETH(
      token.target, // SafeMoon token address
      amountSafeMoon,   // Amount of SafeMoon to add
      0,                // Min amount of SafeMoon (set to 0 for now)
      0,                // Min amount of ETH (set to 0 for now)
      owner.address,    // Address where liquidity tokens are sent
      Math.floor(Date.now() / 1000) + 60 * 10, // Deadline (10 minutes from now)
      { value: amountWETH } // Add ETH value here
    );
    //  await token.excludeFromFees(liquidityPool, false)
  });

  it("Should set the correct token name and symbol", async () => {
    expect(await token.name()).to.equal("Champ");
    expect(await token.symbol()).to.equal("CCG");
  });

  it("Should create a liquidity pool upon deployment", async () => {
    expect(liquidityPool).to.not.equal(ethers.ZeroAddress);
  });


  it("Should correctly set buy and sell taxes", async () => {
    await token.setTaxes(6, 4);
    expect(await token.buyTax()).to.equal(6);
    expect(await token.sellTax()).to.equal(4);
  });

  it("Should revert if taxes exceed 10%", async () => {
    await expect(token.setTaxes(11, 5)).to.be.revertedWith("Tax cannot exceed 10%");
  });

  it("Should Return Balance of Accounts", async () => {
    console.log("Before Trx WETH Balance in token contract :", formatEther(await wethToken.balanceOf(token.target)));
    console.log("Before Trx $SM Balance in wETHHolder contract :", formatEther(await token.balanceOf(wETHHolder.target)));
    console.log("After Trx $SM Balance in token contract :", formatEther(await token.balanceOf(token.target)));
    console.log("Before Trx $SM Balance in owner account :", formatEther(await token.balanceOf(owner.address)));
  });

  it("Should apply taxes on transfer", async () => {
    const amount = ethers.parseUnits("100", 18);

    // Transfer tokens from owner to addr1, should not apply tax
    console.log(formatEther(await token.balanceOf(addr1.address)), "Before Transfer Address 1 Account Balance");
    console.log("Transfer $SM token From owner to Addr 1 & Token Amount ", formatEther(amount));
    await token.transfer(addr1.address, amount);
    expect(await token.balanceOf(addr1.address)).to.equal(amount);

    console.log(formatEther(await token.balanceOf(addr1.address)), "After Trx Address 1 received Amount without Tax Deduction");


    console.log(formatEther(await token.balanceOf(addr2.address)), "Before Trx $SM Balance in Address 2 account");
    // Now, include addr2 and transfer, should apply taxes
    // await token.excludeFromFees(addr1.address, false);
    console.log("Transfer SM tokens from addr 1 to addr 2 & token Amount", formatEther(amount));

    await token.connect(addr1).transfer(addr2.address, amount);

    console.log("After Trx WETH Balance in token contract :", formatEther(await wethToken.balanceOf(token.target)));

    // const taxAmount = (amount * BigInt(buyTax)) / BigInt(100);
    // const amountAfterTax = amount - taxAmount;
    // expect(await token.balanceOf(addr2.address)).to.equal(amountAfterTax);

    console.log(formatEther(await token.balanceOf(addr2.address)), "After Tax deduction SM Balance in address 2");
  });


  it("Should Return Balance of Accounts", async () => {
    console.log("After Trx WETH Balance in token contract :", formatEther(await wethToken.balanceOf(token.target)));
    console.log("After Trx $SM Balance in wETHHolder contract :", formatEther(await token.balanceOf(wETHHolder.target)));
    console.log("After Trx $SM Balance in token contract :", formatEther(await token.balanceOf(token.target)));
    console.log("After Trx $SM Balance in owner account :", formatEther(await token.balanceOf(owner.address)));
  });

  it("Should apply taxes on transferFrom", async () => {
    const amount = ethers.parseUnits("100", 18);

    // Transfer tokens from owner to addr1, should not apply tax
    console.log("Approve Tokens by owner to  addr1", formatEther(amount));
    await token.connect(owner).approve(addr1.address, amount);
    console.log("calling TransferFrom By Addr 1 on behalf owner account  and transfter tokens to addr 1 & token Amount ", formatEther(amount));
    await token.connect(addr1).transferFrom(owner.address, addr1.address, amount);

    console.log("expected balance of condition applied here");
    expect(await token.balanceOf(addr1.address)).to.equal(amount);

    console.log(formatEther(await token.balanceOf(addr2.address)), "Before $SM Balance in Address 2 account");
    console.log(formatEther(await token.balanceOf(addr1.address)), "Before $SM Balance in Address 1 account");
    console.log("Approve call from addr1 to addr2");
    await token.connect(addr1).approve(addr2.address, amount);

    console.log("Send tokens using TransferFrom from addr1 to addr2");
    await token.connect(addr2).transferFrom(addr1.address, addr2.address, amount);

    console.log("After Trx WETH Balance in token contract :", formatEther(await wethToken.balanceOf(token.target)));

    console.log(formatEther(await token.balanceOf(addr2.address)), "After Trasnfer From SM Balance By Addr2");
  });

  it("Should Return Balance of Accounts", async () => {
    console.log("After Trx WETH Balance in token contract :", formatEther(await wethToken.balanceOf(token.target)));
    console.log("After Trx $SM Balance in wETHHolder contract :", formatEther(await token.balanceOf(wETHHolder.target)));
    console.log("After Trx $SM Balance in token contract :", formatEther(await token.balanceOf(token.target)));
    console.log("After Trx $SM Balance in owner account :", formatEther(await token.balanceOf(owner.address)));
  });


  it("Should swap exact ETH for tokens, applying fees on transfer", async () => {
    const ethAmount = ethers.parseUnits("0.05", 18);

    console.log("IS Token Contract Exclude From Fees :", await token.isExcludedFromFees(token.target));

    console.log("$SM Token Balance of addr2 before swap:", formatEther(await token.balanceOf(addr2.address)));

    // Get expected amounts for the swap
    const getamount = await uniswapRouter.getAmountsIn(ethAmount, [token.target, wethAddress]);
    const input = getamount[0].toString();
    const value = getamount[1].toString();

    console.log(formatEther(value), "token Input Amount");
    console.log(formatEther(input), "out will received");

    await uniswapRouter.connect(addr2).swapExactETHForTokensSupportingFeeOnTransferTokens(
      0,           // Token Amount to Swap
      [wethAddress, token.target],  // Path from WETH to the token
      addr2.address,      // Receiver address
      Math.floor(Date.now() / 1000) + 60 * 10, // Deadline set to 10 minutes
      { value, gasLimit: 300000, gasPrice: parseUnits('20', 'gwei') } // Send ETH for the swap
    );
    console.log("$SM Balance of addr2 after swap:", formatEther(await token.balanceOf(addr2.address)));
  });

  it("Should Return Balance of Accounts", async () => {
    console.log("After Trx WETH Balance in token contract :", formatEther(await wethToken.balanceOf(token.target)));
    console.log("After Trx $SM Balance in wETHHolder contract :", formatEther(await token.balanceOf(wETHHolder.target)));
    console.log("After Trx $SM Balance in token contract :", formatEther(await token.balanceOf(token.target)));
    console.log("After Trx $SM Balance in owner account :", formatEther(await token.balanceOf(owner.address)));
  });

  it("Should increase Reflection for other holders", async () => {

    console.log("Distribute reflections");

    console.log("Owner SM Token Balance ", formatEther(await token.balanceOf(owner.address)))

    console.log("Token Transfer from owner to address 1 Amount 5000");
    await token.transfer(addr1.address, ethers.parseUnits("5000", 18)); // Trigger tax

    // Ensure no reflections are claimable
    let claimableOwner = await token.calculateETHClaimable(owner.address)
    let addr1User = await token.calculateETHClaimable(addr1.address)
    let addr2User = await token.calculateETHClaimable(addr2.address)

    console.log("Before Trx Owner old Refelactions", formatEther(claimableOwner))
    console.log("Before Trx addr1 Refelaction in ETH", formatEther(addr1User))
    console.log("Before Trx addr2 Refelaction in ETH", formatEther(addr2User))


    console.log("owner SM Balance ", formatEther(await token.balanceOf(owner.address)))

    console.log("Transfer Tokens from addr 1 to addr 2 amount 100");
    await token.connect(addr1).transfer(addr2.address, ethers.parseUnits("100", 18)); // Trigger tax

    // Ensure no reflections are claimable
    claimableOwner = await token.calculateETHClaimable(owner.address)
    addr1User = await token.calculateETHClaimable(addr1.address)
    addr2User = await token.calculateETHClaimable(addr2.address)

    console.log("After Trx Transfer Owner Refelaction in ETH", formatEther(claimableOwner))
    console.log("After Trx Transfer addr1 Refelaction in ETH", formatEther(addr1User))
    console.log("After Trx Transfer addr2 Refelaction in ETH", formatEther(addr2User))

    console.log("Transfer Tokens from owner to addr 2 Amount 5000");
    await token.transfer(addr2.address, ethers.parseUnits("5000", 18)); // Trigger tax




    // Ensure no reflections are claimable
    claimableOwner = await token.calculateETHClaimable(owner.address)
    addr1User = await token.calculateETHClaimable(addr1.address)
    addr2User = await token.calculateETHClaimable(addr2.address)

    console.log("After 2nd Time Trx Oner Refelaction in ETH", formatEther(claimableOwner))
    console.log("After 2nd Time Trx addr1 Refelaction in ETH", formatEther(addr1User))
    console.log("After 2nd Time Trx addr2 Refelaction in ETH", formatEther(addr2User))

  });

  it("Should Return Balance of Accounts", async () => {
    console.log("After Trx WETH Balance in token contract :", formatEther(await wethToken.balanceOf(token.target)));
    console.log("After Trx $SM Balance in wETHHolder contract :", formatEther(await token.balanceOf(wETHHolder.target)));
    console.log("After Trx $SM Balance in token contract :", formatEther(await token.balanceOf(token.target)));
    console.log("After Trx $SM Balance in owner account :", formatEther(await token.balanceOf(owner.address)));
  });

  // it("Should swap exact tokens for ETH, applying fees on transfer", async () => {
  //   const tokenAmount = ethers.parseUnits("1000", 18); // The amount of tokens you want to swap (100 tokens)

  //   // Check if the target token is excluded from fees
  //   console.log("Is Token Excluded From Fees:", await token.isExcludedFromFees(token.target));

  //   // Print the balance of addr2 before the swap
  //   console.log("Token Balance of addr2 before swap:", formatEther(await token.balanceOf(addr2.address)));

  //   // Approve the Uniswap Router to spend tokens on behalf of addr2
  //   await token.connect(addr2).approve(uniswapRouterAddress, tokenAmount);

  //   // Get expected amounts for the swap (token to ETH)
  //   const amountsOut = await uniswapRouter.getAmountsOut(tokenAmount, [token.target, wethAddress]);
  //   const expectedEthAmount = amountsOut[1].toString(); // The expected ETH amount

  //   console.log(formatEther(expectedEthAmount), "Expected ETH Amount");

  //   // Perform the swap
  //   await uniswapRouter.connect(addr2).swapExactTokensForETHSupportingFeeOnTransferTokens(
  //     tokenAmount,               // The exact amount of tokens to swap
  //     0,                         // Minimum amount of ETH to receive (set to 0 for this test)
  //     [token.target, wethAddress],  // Path from token to WETH (ETH)
  //     addr2.address,             // The receiver of ETH
  //     Math.floor(Date.now() / 1000) + 60 * 10, // Deadline set to 10 minutes from now
  //     { gasLimit: 300000, gasPrice: parseUnits('20', 'gwei') } // Transaction gas settings
  //   );

  //   // Print the balance of addr2 after the swap
  //   console.log("Token Balance of addr2 after swap:", formatEther(await token.balanceOf(addr2.address)));
  //   console.log("ETH Balance of addr2 after swap:", formatEther(await ethers.provider.getBalance(addr2.address)));
  // });

  it("Should Allow claims to convert token into weth and increase the refleactions", async () => {
    addr2User = await token.calculateETHClaimable(addr2.address)
    console.log("Before Convert addr2 Refelaction in ETH", formatEther(addr2User))
    addr2User = await token.calculateETHClaimable(addr1.address)
    console.log("Before Convert addr1 Refelaction in ETH", formatEther(addr2User))

    let claim = await token.connect(addr1).claimReflections(addr1.address)

    addr2User = await token.calculateETHClaimable(addr1.address)
    console.log("After Convert addr1 Refelaction in ETH", formatEther(addr2User))
    addr2User = await token.calculateETHClaimable(addr2.address)
    console.log("After Convert addr2 Refelaction in ETH", formatEther(addr2User))
  });

  it("Should Return Balance of Accounts", async () => {
    console.log("After Trx WETH Balance in token contract :", formatEther(await wethToken.balanceOf(token.target)));
    console.log("After Trx WETH Balance in wETHHolder contract :", formatEther(await wethToken.balanceOf(wETHHolder.target)));
    console.log("After Trx $SM Balance in wETHHolder contract :", formatEther(await token.balanceOf(wETHHolder.target)));
    console.log("After Trx $SM Balance in token contract :", formatEther(await token.balanceOf(token.target)));
    console.log("After Trx $SM Balance in owner account :", formatEther(await token.balanceOf(owner.address)));
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

  describe("Reward Claim System", () => {
    it("Should allow the admin to claim reward points with CHP", async function () {

      await token.excludeFromFees(token.target, true)
      // await token.excludeFromFees(addr1.address, true)

      const amount = parseUnits("100", 18);
      const timeNow = Math.floor(Date.now() / 1000) + 60;
      const abiCoder = new AbiCoder();
      const nonce = await token.userNonce(addr1.address);

      // Create the message hash by encoding the addr1 address and amount
      const messageHash2 = abiCoder.encode(
        ["address", "uint256", "uint256", "uint256"],
        [addr1.address, amount, timeNow, nonce?.toString()]
      );

      const messageHash = solidityPackedKeccak256(
        ["address", "uint256", "uint256", "uint256"],
        [addr1.address, amount, timeNow, nonce?.toString()]
      );

      await token.connect(owner).transfer(admin, amount);

      // Sign the message hash with the admin's private key
      const signature = await admin.signMessage(getBytes(messageHash));
      // Admin claims reward points for the addr1
      await token.connect(admin).claimRewardPointsWithCHP(messageHash2, signature);
    });

    it("Should fail if the addr1 is calling claim reward points with CHP", async function () {
      await token.excludeFromFees(token.target, true)
      // await token.excludeFromFees(addr1.address, true)

      const amount = parseUnits("100", 18);
      const timeNow = Math.floor(Date.now() / 1000) + 60; // Valid timestamp in the future
      const abiCoder = new AbiCoder();
      const wrongNonce = 9999; // Use a nonce that is not correct for the addr1

      // Create the message hash by encoding the addr1 address, amount, timestamp, and the wrong nonce
      const messageHash2 = abiCoder.encode(
        ["address", "uint256", "uint256", "uint256"],
        [addr1.address, amount, timeNow, wrongNonce]
      );

      // Hash the message using the correct fields
      const messageHash = solidityPackedKeccak256(
        ["address", "uint256", "uint256", "uint256"],
        [addr1.address, amount, timeNow, wrongNonce]
      );

      // Sign the message hash with the admin's private key
      const signature = await admin.signMessage(getBytes(messageHash));

      // This should fail because the nonce is incorrect
      await expect(token.connect(addr1).claimRewardPointsWithCHP(messageHash2, signature)).to.be.revertedWith("Only Admin Can Call");
    });

    it("Should fail if the nonce is incorrect", async function () {
      await token.excludeFromFees(token.target, true)
      // await token.excludeFromFees(addr1.address, true)

      const amount = parseUnits("100", 18);
      const timeNow = Math.floor(Date.now() / 1000) + 60; // Valid timestamp in the future
      const abiCoder = new AbiCoder();
      const wrongNonce = 9999; // Use a nonce that is not correct for the addr1

      // Create the message hash by encoding the addr1 address, amount, timestamp, and the wrong nonce
      const messageHash2 = abiCoder.encode(
        ["address", "uint256", "uint256", "uint256"],
        [addr1.address, amount, timeNow, wrongNonce]
      );

      // Hash the message using the correct fields
      const messageHash = solidityPackedKeccak256(
        ["address", "uint256", "uint256", "uint256"],
        [addr1.address, amount, timeNow, wrongNonce]
      );

      await token.connect(owner).transfer(token.target, amount);

      // Sign the message hash with the admin's private key
      const signature = await admin.signMessage(getBytes(messageHash));

      // This should fail because the nonce is incorrect
      await expect(token.connect(admin).claimRewardPointsWithCHP(messageHash2, signature)).to.be.revertedWith("Wrong Nonces");

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
      // Try pausing again (should revert due to cooldown)
      await expect(token.pause()).to.be.revertedWith("Cooldown active: Cannot pause again yet");
    });

    it("Should allow pausing after the cooldown period", async () => {
      let tokenCoundown = await token.PAUSE_COOLDOWN()
      // Skip time to allow cooldown
      await network.provider.send("evm_increaseTime", [tokenCoundown?.toString() + 1]);
      await network.provider.send("evm_mine");

      // Now the owner should be able to pause again
      await token.pause();
      expect(await token.paused()).to.be.true;
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

    it("Should block transfers when contract is paused", async () => {
      const amount = ethers.parseUnits("100", 18);

      // Attempt transfer while paused
      await expect(token.transfer(addr1.address, amount)).to.be.revertedWith("Pausable: paused and time limit not reached");
    });

    it("Should automatically unpause the contract if pause duration has expired", async () => {
      // Pause the contract
      let tokenCoundown = await token.MAX_PAUSE_DURATION()

      // Simulate time passing beyond the max pause duration
      await network.provider.send("evm_increaseTime", [tokenCoundown?.toString() + 1]);
      await network.provider.send("evm_mine");

      // Check if the contract auto unpauses after the max duration
      await token.connect(owner).transfer(addr1.address, ethers.parseUnits("100", 18)); // Triggering transfer (should now succeed)
      expect(await token.paused()).to.be.false; // Contract should be unpaused automatically
    });

    it("Should revert transfers if the contract is paused and the pause period has not expired", async () => {
      // Pause the contract
      await token.pause();
      expect(await token.paused()).to.be.true;

      // Transfer should still fail if the pause period has not expired
      await expect(token.transfer(addr1.address, ethers.parseUnits("100", 18))).to.be.revertedWith("Pausable: paused and time limit not reached");
    });

    it("Should allow transfer once unpaused", async () => {
      const amount = ethers.parseUnits("100", 18);

      // Pause the contract
      let MAX_PAUSE_DURATION = await token.MAX_PAUSE_DURATION()

      // Unpause after max duration has passed
      await network.provider.send("evm_increaseTime", [MAX_PAUSE_DURATION?.toString() + 1]);
      await network.provider.send("evm_mine");

      // Unpause the contract
      await token.unpause();
      expect(await token.paused()).to.be.false;
      const amount2 = ethers.parseUnits("5200", 18);
      // Perform transfer after unpause
      await token.transfer(addr1.address, amount);
      expect(await token.balanceOf(addr1.address)).to.equal(amount2);
    });
  })
});
