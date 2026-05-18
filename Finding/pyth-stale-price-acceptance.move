#[test_only]
module oracle::poc_test {
    use sui::test_scenario;
    use sui::clock::{Self};
    use oracle::oracle::{Self, PriceOracle};
    use oracle::config::{Self, OracleConfig};
    use oracle::oracle_global::{Self as global};
    use oracle::oracle_pro;
    use oracle::oracle_lib::{Self as lib};
    use oracle::strategy;
    use std::vector::{Self};

    const OWNER: address = @0xA;

    // =========================================================================
    // TEST 1: Stale price accepted through unsafe Pyth path
    // =========================================================================
    #[test]
    public fun test_stale_price_accepted_50s() {
        let _scenario = test_scenario::begin(OWNER);
        let scenario = &mut _scenario;
        let _clock = clock::create_for_testing(test_scenario::ctx(scenario));

        { global::init_protocol(scenario); };

        test_scenario::next_tx(scenario, OWNER);
        {
            let price_oracle = test_scenario::take_shared<PriceOracle>(scenario);
            let oracle_config = test_scenario::take_shared<OracleConfig>(scenario);

            let address_vec = config::get_vec_feeds(&oracle_config);
            let feed_id = *vector::borrow(&address_vec, 0);

            let current_time: u64 = 100_000;
            clock::set_for_testing(&mut _clock, current_time);

            let pyth_stale_timestamp: u64 = 50_000;
            let supra_timestamp: u64 = current_time;

            let stale_price: u256 = 9_000000;

            lib::printf(b"=== stale price accepted via get_price_unsafe ===");

            let is_fresh = strategy::is_oracle_price_fresh(
                current_time,
                pyth_stale_timestamp,
                60_000
            );

            lib::printf(b"[CHECK] freshness result =");
            lib::print(&is_fresh);

            assert!(is_fresh == true, 0);

            oracle_pro::update_single_price_for_testing(
                &_clock,
                &mut oracle_config,
                &mut price_oracle,
                stale_price,
                pyth_stale_timestamp,
                stale_price,
                supra_timestamp,
                feed_id,
            );

            let (valid, committed_price, _decimal) =
                oracle::get_token_price(&_clock, &price_oracle, 0);

            lib::printf(b"[RESULT] valid =");
            lib::print(&valid);

            lib::printf(b"[RESULT] committed_price =");
            lib::print(&committed_price);

            assert!(valid == true, 1);
            assert!(committed_price == stale_price, 2);

            test_scenario::return_shared(price_oracle);
            test_scenario::return_shared(oracle_config);
        };

        clock::destroy_for_testing(_clock);
        test_scenario::end(_scenario);
    }

    // =========================================================================
    // TEST 2: 59_999 ms stale still accepted
    // =========================================================================
    #[test]
    public fun test_boundary_59999ms_stale_accepted() {
        let _scenario = test_scenario::begin(OWNER);
        let scenario = &mut _scenario;
        let _clock = clock::create_for_testing(test_scenario::ctx(scenario));

        { global::init_protocol(scenario); };

        test_scenario::next_tx(scenario, OWNER);
        {
            let price_oracle = test_scenario::take_shared<PriceOracle>(scenario);
            let oracle_config = test_scenario::take_shared<OracleConfig>(scenario);

            let address_vec = config::get_vec_feeds(&oracle_config);
            let feed_id = *vector::borrow(&address_vec, 0);

            let current_time: u64 = 200_000;
            clock::set_for_testing(&mut _clock, current_time);

            let near_stale_timestamp: u64 = current_time - 59_999;
            let stale_price: u256 = 9_000000;

            lib::printf(b"=== 59_999ms stale accepted ===");

            let is_fresh = strategy::is_oracle_price_fresh(
                current_time,
                near_stale_timestamp,
                60_000
            );

            lib::printf(b"[CHECK] freshness result =");
            lib::print(&is_fresh);

            oracle_pro::update_single_price_for_testing(
                &_clock,
                &mut oracle_config,
                &mut price_oracle,
                stale_price,
                near_stale_timestamp,
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

    // =========================================================================
    // TEST 3: 60_000 ms stale rejected by protocol
    // =========================================================================
    #[test]
    public fun test_boundary_60000ms_stale_rejected() {
        let _scenario = test_scenario::begin(OWNER);
        let scenario = &mut _scenario;
        let _clock = clock::create_for_testing(test_scenario::ctx(scenario));

        { global::init_protocol(scenario); };

        test_scenario::next_tx(scenario, OWNER);
        {
            let price_oracle = test_scenario::take_shared<PriceOracle>(scenario);
            let oracle_config = test_scenario::take_shared<OracleConfig>(scenario);

            let address_vec = config::get_vec_feeds(&oracle_config);
            let feed_id = *vector::borrow(&address_vec, 0);

            let current_time: u64 = 200_000;
            clock::set_for_testing(&mut _clock, current_time);

            let expired_timestamp: u64 = current_time - 60_000;

            lib::printf(b"=== 60_000ms stale rejected ===");

            let is_fresh = strategy::is_oracle_price_fresh(
                current_time,
                expired_timestamp,
                60_000
            );

            lib::printf(b"[CHECK] freshness result =");
            lib::print(&is_fresh);

            assert!(is_fresh == false, 0);

            let result = oracle_pro::update_single_price_for_testing_non_abort(
                &_clock,
                &mut oracle_config,
                &mut price_oracle,
                9_000000,
                expired_timestamp,
                9_000000,
                expired_timestamp,
                feed_id,
            );

            lib::printf(b"[RESULT] return code =");
            lib::print(&result);

            assert!(result == 4, 1);

            test_scenario::return_shared(price_oracle);
            test_scenario::return_shared(oracle_config);
        };

        clock::destroy_for_testing(_clock);
        test_scenario::end(_scenario);
    }

    // =========================================================================
    // TEST 4: Adaptor dispatch uses get_price_unsafe
    // =========================================================================
    #[test]
    public fun test_adaptor_dispatch_unsafe_no_freshness_enforcement() {
        let _scenario = test_scenario::begin(OWNER);
        let scenario = &mut _scenario;
        let _clock = clock::create_for_testing(test_scenario::ctx(scenario));

        { global::init_protocol(scenario); };

        test_scenario::next_tx(scenario, OWNER);
        {
            let price_oracle = test_scenario::take_shared<PriceOracle>(scenario);
            let oracle_config = test_scenario::take_shared<OracleConfig>(scenario);

            let address_vec = config::get_vec_feeds(&oracle_config);
            let feed_id = *vector::borrow(&address_vec, 0);

            let current_time: u64 = 300_000;
            clock::set_for_testing(&mut _clock, current_time);

            lib::printf(b"=== adaptor dispatch uses get_price_unsafe ===");

            let ts_35s_stale: u64 = current_time - 35_000;
            let ts_59s_stale: u64 = current_time - 59_000;

            let is_fresh_35s = strategy::is_oracle_price_fresh(
                current_time,
                ts_35s_stale,
                60_000
            );

            let is_fresh_59s = strategy::is_oracle_price_fresh(
                current_time,
                ts_59s_stale,
                60_000
            );

            lib::printf(b"[CHECK] 35s stale =");
            lib::print(&is_fresh_35s);

            lib::printf(b"[CHECK] 59s stale =");
            lib::print(&is_fresh_59s);

            assert!(is_fresh_35s == true, 0);
            assert!(is_fresh_59s == true, 1);

            let stale_35s_price: u256 = 8_500000;

            oracle_pro::update_single_price_for_testing(
                &_clock,
                &mut oracle_config,
                &mut price_oracle,
                stale_35s_price,
                ts_35s_stale,
                stale_35s_price,
                current_time,
                feed_id,
            );

            let (valid, committed_price, _) =
                oracle::get_token_price(&_clock, &price_oracle, 0);

            lib::printf(b"[RESULT] valid =");
            lib::print(&valid);

            lib::printf(b"[RESULT] committed_price =");
            lib::print(&committed_price);

            assert!(valid == true, 2);
            assert!(committed_price == stale_35s_price, 3);

            test_scenario::return_shared(price_oracle);
            test_scenario::return_shared(oracle_config);
        };

        clock::destroy_for_testing(_clock);
        test_scenario::end(_scenario);
    }

    // =========================================================================
    // TEST 5: Downstream consumer receives stale committed price
    // =========================================================================
    #[test]
    public fun test_downstream_consumer_receives_stale_price() {
        let _scenario = test_scenario::begin(OWNER);
        let scenario = &mut _scenario;
        let _clock = clock::create_for_testing(test_scenario::ctx(scenario));

        { global::init_protocol(scenario); };

        test_scenario::next_tx(scenario, OWNER);
        {
            let price_oracle = test_scenario::take_shared<PriceOracle>(scenario);
            let oracle_config = test_scenario::take_shared<OracleConfig>(scenario);

            let address_vec = config::get_vec_feeds(&oracle_config);
            let feed_id = *vector::borrow(&address_vec, 0);

            let current_time: u64 = 155_000;
            clock::set_for_testing(&mut _clock, current_time);

            lib::printf(b"=== downstream consumer receives stale price ===");

            let pyth_stale_price: u256 = 9_500000;
            let supra_fresh_price: u256 = 9_400000;

            let pyth_ts: u64 = current_time - 35_000;

            oracle_pro::update_single_price_for_testing(
                &_clock,
                &mut oracle_config,
                &mut price_oracle,
                pyth_stale_price,
                pyth_ts,
                supra_fresh_price,
                current_time,
                feed_id,
            );

            let (valid, consumer_price, _) =
                oracle::get_token_price(&_clock, &price_oracle, 0);

            lib::printf(b"[RESULT] valid =");
            lib::print(&valid);

            lib::printf(b"[RESULT] consumer_price =");
            lib::print(&consumer_price);

            assert!(valid == true, 0);
            assert!(consumer_price == pyth_stale_price, 1);

            test_scenario::return_shared(price_oracle);
            test_scenario::return_shared(oracle_config);
        };

        clock::destroy_for_testing(_clock);
        test_scenario::end(_scenario);
    }
}