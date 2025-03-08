// SPDX-License-Identifier: MIT
const { ethers } = require("hardhat");

async function main() {
  // Fetch signers
  const [owner] = await ethers.getSigners();
  console.log("Deployer : ", owner.address)
  // Parameters
  const uniswapRouterAddress = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24";  //Uniswap V2 Router:0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24
  // const initialSupply = ethers.parseUnits("1000000000", 18); // 1 Billion tokens
  const amountSafeMoon = ethers.parseUnits("2500000000", 18); // SafeMoon tokens for liquidity
  const amountWETH = ethers.parseEther("0.01"); // WETH for liquidity
  let transaction
  // Fetch the Uniswap Router Contract
  const uniswapRouter = await ethers.getContractAt("IUniswapV2Router02", uniswapRouterAddress);
  // const wethAddress = await uniswapRouter.WETH();

  // Deploy WETHHolder
  console.log("Deploying WETHHolder...");
  const WETHHolder = await ethers.getContractFactory("WETHHolder");
  const wETHHolder = await WETHHolder.deploy(owner.address);
  await wETHHolder.waitForDeployment();
  console.log("WETHHolder deployed at:", wETHHolder.target);

  // Deploy SafeMoonLikeToken
  console.log("Deploying SafeMoonLikeToken...");
  const SafeMoonLikeToken = await ethers.getContractFactory("CryptoChamps");
  const token = await SafeMoonLikeToken.deploy(uniswapRouterAddress, owner.address, wETHHolder.target);
  await token.waitForDeployment();
  console.log("SafeMoonLikeToken deployed at:", token.target);

  // Transfer ownership of WETHHolder to SafeMoonLikeToken
  transaction = await wETHHolder.transferOwnership(token.target);
  transaction.wait()
  // Exclude addresses from fees
  const liquidityPool = await token.liquidityPool();
  console.log("Liquidity Pool Address:", liquidityPool);
  transaction = await token.excludeFromFees(liquidityPool, true);
  transaction.wait()

  // Approve token for Uniswap Router
  console.log("Approving tokens for Uniswap Router...");
  transaction = await token.approve(uniswapRouterAddress, amountSafeMoon);
  transaction.wait()

  // Add liquidity to Uniswap
  // console.log("Adding liquidity to Uniswap...");
  // transaction = await uniswapRouter.addLiquidityETH(
  //   "0x8369c0f98D8485FF8F1d9db71529D66a56D3DdB6",       // Token address
  //   amountSafeMoon,     // Amount of SafeMoon tokens
  //   0,                  // Min token amount
  //   0,                  // Min ETH amount
  //   owner.address,      // Liquidity recipient
  //   Math.floor(Date.now() / 1000) + 60 * 10, // Deadline (10 minutes from now)
  //   { value: amountWETH } // ETH value for liquidity
  // );
  // transaction.wait()
  // console.log("Liquidity successfully added!");
}

async function verifyContract(contractAddress, constructorArguments) {
  try {
    console.log(`Verifying contract at ${contractAddress}...`);
    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: constructorArguments,
    });
  } catch (error) {
    console.error(`Verification failed for ${contractAddress}:`, error);
  }
}


main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error in script:", error);
    process.exit(1);
  });
