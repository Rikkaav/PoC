import { expect } from "chai";
import { ethers } from "hardhat";

// Constants

const ONE = ethers.parseEther("1");
const LIQ_INC = ethers.parseEther("1.10");

const PRICE_USDC = ethers.parseEther("1");
const PRICE_WBTC = ethers.parseEther("30000");

function fmt(v: bigint, label = "") {
  const s = ethers.formatEther(v);
  return label ? `${label}: ${s}` : s;
}

// Math helpers

function rdiv(x: bigint, y: bigint): bigint {
  return (x * ONE) / y;
}

function rmul(x: bigint, y: bigint): bigint {
  return (x * y) / ONE;
}

// Current implementation

function seizedCurrent(
  valueRepayPlusIncentive: bigint,
  exchangeRate: bigint,
  priceCollateral: bigint
): bigint {
  const intermediate = rdiv(valueRepayPlusIncentive, exchangeRate);
  return intermediate / priceCollateral;
}

// Fixed implementation

function seizedFixed(
  valueRepayPlusIncentive: bigint,
  exchangeRate: bigint,
  priceCollateral: bigint
): bigint {
  const combined = rmul(exchangeRate, priceCollateral);
  return rdiv(valueRepayPlusIncentive, combined);
}

// Exact reference

const SCALE_1E36 = 1000000000000000000000000000000000000n;

function seizedExact(
  valueRepayPlusIncentive: bigint,
  exchangeRate: bigint,
  priceCollateral: bigint
): bigint {
  return (
    (valueRepayPlusIncentive * SCALE_1E36) /
    (exchangeRate * priceCollateral)
  );
}

// Tests

describe("PoC - Precision loss in liquidateCalculateSeizeTokensV2", function () {
  describe("1. Pure math: sequential vs combined division", function () {
    it("1a. Shows truncation gap for representative WBTC liquidation", async function () {
      const repayAmount = ethers.parseEther("0.01");
      const exchangeRate = ONE;

      const valueRepay = rmul(repayAmount, PRICE_WBTC);
      const valueRepayInc = rmul(valueRepay, LIQ_INC);

      const current = seizedCurrent(
        valueRepayInc,
        exchangeRate,
        PRICE_WBTC
      );

      const fixed = seizedFixed(
        valueRepayInc,
        exchangeRate,
        PRICE_WBTC
      );

      const exact = seizedExact(
        valueRepayInc,
        exchangeRate,
        PRICE_WBTC
      );

      const gapFixedVsCurrent = fixed - current;
      const gapExactVsCurrent = exact - current;

      console.log("\n──────────────────────────────────────────────────");
      console.log("Scenario: liquidate 0.01 WBTC at $30,000");
      console.log("repayValue+incentive :", fmt(valueRepayInc));
      console.log("exchangeRate         :", fmt(exchangeRate));
      console.log("priceCollateral      :", fmt(PRICE_WBTC));
      console.log("──────────────────────────────────────────────────");
      console.log("current seized :", current.toString(), "wei");
      console.log("fixed seized   :", fixed.toString(), "wei");
      console.log("exact seized   :", exact.toString(), "wei");
      console.log("gap fixed-current :", gapFixedVsCurrent.toString(), "wei");
      console.log("gap exact-current :", gapExactVsCurrent.toString(), "wei");

      expect(fixed).to.be.gte(current);
      expect(gapFixedVsCurrent).to.be.gte(0n);
      expect(current).to.equal(0n);
      expect(fixed).to.be.gt(0n);
    });

    it("1b. Gap grows with repay amount", async function () {
      const exchangeRate = ONE;

      const amounts = [
        ethers.parseEther("0.001"),
        ethers.parseEther("0.01"),
        ethers.parseEther("0.1"),
        ethers.parseEther("1"),
      ];

      console.log("\n── Gap vs repay amount ───────────────────────────");
      console.log(
        " repayAmt | current(wei) | fixed(wei) | gap(wei)"
      );

      let prevGap = 0n;

      for (const repay of amounts) {
        const valueInc = rmul(
          rmul(repay, PRICE_WBTC),
          LIQ_INC
        );

        const cur = seizedCurrent(
          valueInc,
          exchangeRate,
          PRICE_WBTC
        );

        const fix = seizedFixed(
          valueInc,
          exchangeRate,
          PRICE_WBTC
        );

        const gap = fix - cur;

        console.log(
          " ",
          ethers.formatEther(repay).padEnd(9),
          "|",
          cur.toString().padEnd(20),
          "|",
          fix.toString().padEnd(20),
          "|",
          gap.toString()
        );

        expect(fix).to.be.gte(cur);

        if (prevGap > 0n) {
          expect(gap).to.be.gte(prevGap);
        }

        prevGap = gap;
      }
    });

    it("1c. High-price collateral amplifies truncation error", async function () {
      const repayValue = ethers.parseEther("1000");
      const valueInc = rmul(repayValue, LIQ_INC);
      const exchangeRate = ONE;

      const curUSDC = seizedCurrent(
        valueInc,
        exchangeRate,
        PRICE_USDC
      );

      const fixUSDC = seizedFixed(
        valueInc,
        exchangeRate,
        PRICE_USDC
      );

      const gapUSDC = fixUSDC - curUSDC;

      const curWBTC = seizedCurrent(
        valueInc,
        exchangeRate,
        PRICE_WBTC
      );

      const fixWBTC = seizedFixed(
        valueInc,
        exchangeRate,
        PRICE_WBTC
      );

      const gapWBTC = fixWBTC - curWBTC;

      console.log("\n── Price impact on truncation ───────────────────");
      console.log(
        "USDC  current:",
        curUSDC.toString(),
        "| fixed:",
        fixUSDC.toString(),
        "| gap:",
        gapUSDC.toString()
      );

      console.log(
        "WBTC  current:",
        curWBTC.toString(),
        "| fixed:",
        fixWBTC.toString(),
        "| gap:",
        gapWBTC.toString()
      );

      expect(fixUSDC).to.be.gte(curUSDC);
      expect(fixWBTC).to.be.gte(curWBTC);
    });

    it("1d. Accumulated loss across many liquidations", async function () {
      const N = 1000n;
      const repay = ethers.parseEther("0.01");
      const exchangeRate = ONE;

      const valueInc = rmul(
        rmul(repay, PRICE_WBTC),
        LIQ_INC
      );

      const perLiqGap =
        seizedFixed(valueInc, exchangeRate, PRICE_WBTC) -
        seizedCurrent(valueInc, exchangeRate, PRICE_WBTC);

      const totalGap = perLiqGap * N;

      const totalValue =
        (totalGap * PRICE_WBTC) / ONE;

      console.log(
        "\n── Accumulated loss across",
        N,
        "liquidations ─────────────"
      );

      console.log(
        "per-liquidation gap:",
        perLiqGap.toString(),
        "wei iWBTC"
      );

      console.log(
        "total gap:",
        ethers.formatEther(totalGap),
        "iWBTC"
      );

      console.log(
        "total USD value:",
        ethers.formatEther(totalValue),
        "USD"
      );

      expect(totalGap).to.equal(perLiqGap * N);
      expect(perLiqGap).to.be.gt(0n);
    });
  });

  describe("2. Root cause: two truncations vs one", function () {
    it("2a. Two divisions vs one division", async function () {
      const x = 330_000_000_000_000_001n;
      const a = ONE;
      const b = PRICE_WBTC;

      const twoDiv = rdiv(x, a) / b;
      const oneDiv = rdiv(x, rmul(a, b));

      console.log("\n── Two-div vs One-div ───────────────────────────");
      console.log("x              :", x.toString());
      console.log("two-div result :", twoDiv.toString());
      console.log("one-div result :", oneDiv.toString());
      console.log(
        "delta          :",
        (oneDiv - twoDiv).toString(),
        "wei"
      );

      expect(oneDiv).to.be.gte(twoDiv);
    });

    it("2b. Current path returns zero after truncation", async function () {
      const value = ethers.parseEther("330");
      const exchangeRate = ONE;
      const price = PRICE_WBTC;

      const intermediate = rdiv(value, exchangeRate);
      const result = intermediate / price;

      console.log(
        "\n── Intermediate underflow demonstration ─────────"
      );

      console.log("value        :", value.toString());
      console.log("intermediate :", intermediate.toString());
      console.log("price        :", price.toString());
      console.log("current      :", result.toString());
      console.log(
        "fixed        :",
        seizedFixed(value, exchangeRate, price).toString()
      );

      expect(result).to.equal(0n);

      expect(
        seizedFixed(value, exchangeRate, price)
      ).to.be.gt(0n);
    });
  });
});