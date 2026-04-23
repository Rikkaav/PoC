import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const THRESHOLD = 10000n;
const BASE = ethers.parseEther("1");

async function mintUnderlying(
  underlying: any,
  to: string,
  amount: bigint
) {
  await underlying.mint(to, amount);
}

describe("PoC - Redeem Liveness Failure at Supply Threshold", function () {
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  let underlying: any;
  let controller: any;
  let iToken: any;
  let interestModel: any;
  let oracle: any;
  let rewardDistributor: any;

  async function bootstrapAtThreshold(
    holder: HardhatEthersSigner
  ) {
    // User flow:
    // acquire underlying -> approve -> mint exactly threshold supply

    await mintUnderlying(
      underlying,
      holder.address,
      THRESHOLD
    );

    await underlying
      .connect(holder)
      .approve(iToken.target, THRESHOLD);

    await iToken
      .connect(holder)
      .mint(holder.address, THRESHOLD);

    expect(
      await iToken.totalSupply()
    ).to.equal(THRESHOLD);

    expect(
      await iToken.balanceOf(holder.address)
    ).to.equal(THRESHOLD);

    // Deposited underlying is fully custodied by the market
    expect(
      await underlying.balanceOf(iToken.target)
    ).to.equal(THRESHOLD);
  }

  beforeEach(async () => {
    [deployer, alice, bob] =
      await ethers.getSigners();

    const Token =
      await ethers.getContractFactory("Token");

    underlying = await Token.deploy(
      "Mock USDC",
      "USDC",
      18n
    );

    const IRM =
      await ethers.getContractFactory(
        "MockRateModelNoInterest"
      );

    interestModel = await IRM.deploy();

    await interestModel.setIsInterestRateModel(
      true
    );

    const Oracle =
      await ethers.getContractFactory(
        "PriceOracleV2"
      );

    oracle = await Oracle.deploy(
      deployer.address,
      ethers.parseEther("0.1")
    );

    const Controller =
      await ethers.getContractFactory(
        "Controller"
      );

    controller = await Controller.deploy();
    await controller.initialize();

    const RewardDistributor =
      await ethers.getContractFactory(
        "RewardDistributor"
      );

    rewardDistributor =
      await RewardDistributor.deploy();

    await rewardDistributor.initialize(
      controller.target
    );

    await controller._setRewardDistributor(
      rewardDistributor.target
    );

    await controller._setPriceOracle(
      oracle.target
    );

    await controller._setCloseFactor(
      ethers.parseEther("0.5")
    );

    await controller._setLiquidationIncentive(
      ethers.parseEther("1.1")
    );

    const IToken =
      await ethers.getContractFactory(
        "iToken"
      );

    iToken = await IToken.deploy();

    await iToken.initialize(
      underlying.target,
      "dForce Mock USDC",
      "iUSDC",
      controller.target,
      interestModel.target
    );

    await oracle.setPrice(
      iToken.target,
      BASE
    );

    await controller._addMarket(
      iToken.target,
      ethers.parseEther("0.9"),
      ethers.parseEther("0.9"),
      ethers.parseEther("1000000"),
      ethers.parseEther("1000000"),
      0n
    );
  });

  it("partial redeem becomes impossible at threshold boundary", async () => {
    await bootstrapAtThreshold(alice);

    console.log(
      "\n=== Threshold Boundary Liveness Failure ==="
    );

    expect(
      await underlying.balanceOf(alice.address)
    ).to.equal(0n);

    expect(
      await underlying.balanceOf(iToken.target)
    ).to.equal(THRESHOLD);

    console.log(
      "Attempting redeem(1) from threshold supply..."
    );

    await expect(
      iToken.connect(alice).redeem(
        alice.address,
        1n
      )
    ).to.be.revertedWith(
      "_redeemInternal: totalSupply too small!"
    );

    // No state transition occurred
    expect(
      await iToken.totalSupply()
    ).to.equal(THRESHOLD);

    expect(
      await iToken.balanceOf(alice.address)
    ).to.equal(THRESHOLD);

    expect(
      await underlying.balanceOf(alice.address)
    ).to.equal(0n);

    const poolUnderlying =
      await underlying.balanceOf(iToken.target);

    expect(
      poolUnderlying
    ).to.equal(THRESHOLD);

    // Asset backing invariant:
    // trapped underlying exactly backs non-redeemable supply
    expect(
      poolUnderlying
    ).to.equal(
      await iToken.totalSupply()
    );

    console.log(
      "Result: redeem reverted with no state mutation."
    );

    console.log(
      `Invariant preserved: ${poolUnderlying} underlying remains trapped backing ${THRESHOLD} non-redeemable supply.`
    );
  });

  it("distributed holders cannot make progress toward redemption", async () => {
    await bootstrapAtThreshold(alice);

    await iToken
      .connect(alice)
      .transfer(
        bob.address,
        2000n
      );

    console.log(
      "\n=== Distributed Holder Liveness Failure ==="
    );

    // Invariant: distributed ownership does not alter the supply sum
    const totalDistributedBalances = 
      (await iToken.balanceOf(alice.address)) + 
      (await iToken.balanceOf(bob.address));
    
    expect(totalDistributedBalances).to.equal(THRESHOLD);

    console.log(
      "Attempting near-full partial exit (7999)..."
    );

    await expect(
      iToken.connect(alice).redeem(
        alice.address,
        7999n
      )
    ).to.be.revertedWith(
      "_redeemInternal: totalSupply too small!"
    );

    console.log(
      "Near-full partial exit also reverts."
    );

    await expect(
      iToken.connect(alice).redeem(
        alice.address,
        1n
      )
    ).to.be.revertedWith(
      "_redeemInternal: totalSupply too small!"
    );

    await expect(
      iToken.connect(bob).redeem(
        bob.address,
        1n
      )
    ).to.be.revertedWith(
      "_redeemInternal: totalSupply too small!"
    );

    expect(
      await iToken.totalSupply()
    ).to.equal(THRESHOLD);

    const poolUnderlying =
      await underlying.balanceOf(iToken.target);

    expect(
      poolUnderlying
    ).to.equal(THRESHOLD);

    expect(
      poolUnderlying
    ).to.equal(
      await iToken.totalSupply()
    );

    const aliceBal =
      await iToken.balanceOf(alice.address);

    const bobBal =
      await iToken.balanceOf(bob.address);

    console.log(
      `${aliceBal} remains trapped for Alice`
    );

    console.log(
      `${bobBal} remains trapped for Bob`
    );
  });

  it("supply cannot be reduced below threshold through progressive redemption", async () => {
    await bootstrapAtThreshold(alice);

    await iToken.connect(alice).transfer(
      bob.address,
      5000n
    );

    console.log(
      "\n=== Progressive Supply Reduction Failure ==="
    );

    // Liveness invariant:
    // positive balances exist,
    // redeem function available,
    // but no holder can reduce supply.
    for (let i = 0; i < 5; i++) {
      await expect(
        iToken.connect(alice).redeem(
          alice.address,
          1n
        )
      ).to.be.reverted;

      await expect(
        iToken.connect(bob).redeem(
          bob.address,
          1n
        )
      ).to.be.reverted;
    }

    expect(
      await iToken.totalSupply()
    ).to.equal(THRESHOLD);

    const poolUnderlying = 
      await underlying.balanceOf(iToken.target);

    expect(
      poolUnderlying
    ).to.equal(THRESHOLD);

    // Asset backing invariant
    expect(
      poolUnderlying
    ).to.equal(
      await iToken.totalSupply()
    );

    expect(
      await iToken.balanceOf(alice.address)
    ).to.equal(5000n);

    expect(
      await iToken.balanceOf(bob.address)
    ).to.equal(5000n);

    console.log(
      "Repeated redeem attempts make no progress; supply remains non-reducible."
    );
  });

  it("full redeem of entire remaining supply still succeeds", async () => {
    await bootstrapAtThreshold(alice);

    console.log(
      "\n=== Control: Full Supply Exit ==="
    );

    await expect(
      iToken.connect(alice).redeem(
        alice.address,
        THRESHOLD
      )
    ).to.not.be.reverted;

    expect(
      await iToken.totalSupply()
    ).to.equal(0n);

    expect(
      await underlying.balanceOf(iToken.target)
    ).to.equal(0n);

    expect(
      await iToken.balanceOf(alice.address)
    ).to.equal(0n);

    console.log(
      "Full redemption succeeds when supply exits directly to zero."
    );
  });
});