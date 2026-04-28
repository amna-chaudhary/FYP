module gec::gec_marketplace {
    use std::signer;
    use std::vector;

    const E_ALREADY_INITIALIZED: u64 = 1;
    const E_NOT_INITIALIZED: u64 = 2;
    const E_NOT_LISTING_OWNER: u64 = 3;
    const E_LISTING_NOT_FOUND: u64 = 4;
    const E_LISTING_NOT_ACTIVE: u64 = 5;

    const LISTING_ACTIVE: u8 = 1;
    const LISTING_CANCELLED: u8 = 2;
    const LISTING_PENDING: u8 = 3;
    const LISTING_SOLD: u8 = 4;

    struct Listing has store, drop {
        listing_id: u64,
        cert_id: u64,
        seller: address,
        buyer: address,
        price: u64,
        status: u8,
    }

    struct Marketplace has key {
        owner: address,
        next_listing_id: u64,
        total_trades: u64,
        total_volume: u64,
        listings: vector<Listing>,
    }

    public entry fun initialize_marketplace(account: &signer) {
        let account_addr = signer::address_of(account);
        assert!(!exists<Marketplace>(account_addr), E_ALREADY_INITIALIZED);

        move_to(
            account,
            Marketplace {
                owner: account_addr,
                next_listing_id: 1,
                total_trades: 0,
                total_volume: 0,
                listings: vector::empty<Listing>(),
            }
        );
    }

    public entry fun list_certificate(
        account: &signer,
        market_addr: address,
        cert_id: u64,
        price: u64,
    ) acquires Marketplace {
        let market = borrow_global_mut<Marketplace>(market_addr);
        let seller = signer::address_of(account);

        let listing = Listing {
            listing_id: market.next_listing_id,
            cert_id,
            seller,
            buyer: @0x0,
            price,
            status: LISTING_ACTIVE,
        };

        market.next_listing_id = market.next_listing_id + 1;
        vector::push_back(&mut market.listings, listing);
    }

    public entry fun cancel_listing(account: &signer, market_addr: address, listing_id: u64) acquires Marketplace {
        let market = borrow_global_mut<Marketplace>(market_addr);
        let listing = borrow_listing_mut(market, listing_id);

        assert!(listing.seller == signer::address_of(account), E_NOT_LISTING_OWNER);
        assert!(listing.status == LISTING_ACTIVE || listing.status == LISTING_PENDING, E_LISTING_NOT_ACTIVE);

        listing.status = LISTING_CANCELLED;
    }

    public entry fun request_buy(account: &signer, market_addr: address, listing_id: u64) acquires Marketplace {
        let market = borrow_global_mut<Marketplace>(market_addr);
        let listing = borrow_listing_mut(market, listing_id);

        assert!(listing.status == LISTING_ACTIVE, E_LISTING_NOT_ACTIVE);
        listing.buyer = signer::address_of(account);
        listing.status = LISTING_PENDING;
    }

    public entry fun accept_buy_request(account: &signer, market_addr: address, listing_id: u64) acquires Marketplace {
        let market = borrow_global_mut<Marketplace>(market_addr);
        let listing = borrow_listing_mut(market, listing_id);

        assert!(listing.seller == signer::address_of(account), E_NOT_LISTING_OWNER);
        assert!(listing.status == LISTING_PENDING, E_LISTING_NOT_ACTIVE);

        listing.status = LISTING_SOLD;
        market.total_trades = market.total_trades + 1;
        market.total_volume = market.total_volume + listing.price;
    }

    #[view]
    public fun get_listing_count(market_addr: address): u64 acquires Marketplace {
        vector::length(&borrow_global<Marketplace>(market_addr).listings)
    }

    #[view]
    public fun get_total_trades(market_addr: address): u64 acquires Marketplace {
        borrow_global<Marketplace>(market_addr).total_trades
    }

    #[view]
    public fun get_total_volume(market_addr: address): u64 acquires Marketplace {
        borrow_global<Marketplace>(market_addr).total_volume
    }

    fun borrow_listing_mut(market: &mut Marketplace, listing_id: u64): &mut Listing {
        let len = vector::length(&market.listings);
        let mut i = 0;
        while (i < len) {
            let listing = vector::borrow_mut(&mut market.listings, i);
            if (listing.listing_id == listing_id) {
                return listing
            };
            i = i + 1;
        };
        abort E_LISTING_NOT_FOUND
    }

    #[test(account = @gec, buyer = @0x123)]
    public entry fun test_list_and_accept(account: signer, buyer: signer) acquires Marketplace {
        initialize_marketplace(&account);
        list_certificate(&account, signer::address_of(&account), 1, 50);
        request_buy(&buyer, signer::address_of(&account), 1);
        accept_buy_request(&account, signer::address_of(&account), 1);

        let market = borrow_global<Marketplace>(signer::address_of(&account));
        assert!(market.total_trades == 1, 2000);
        assert!(market.total_volume == 50, 2001);
    }

    #[test(account = @gec)]
    public entry fun test_cancel_listing(account: signer) acquires Marketplace {
        initialize_marketplace(&account);
        list_certificate(&account, signer::address_of(&account), 2, 75);
        cancel_listing(&account, signer::address_of(&account), 1);

        let market = borrow_global<Marketplace>(signer::address_of(&account));
        let listing = vector::borrow(&market.listings, 0);
        assert!(listing.status == LISTING_CANCELLED, 2002);
    }

    #[test(account = @gec, buyer = @0x123)]
    public entry fun test_request_buy_sets_pending(account: signer, buyer: signer) acquires Marketplace {
        initialize_marketplace(&account);
        list_certificate(&account, signer::address_of(&account), 3, 80);
        request_buy(&buyer, signer::address_of(&account), 1);

        let market = borrow_global<Marketplace>(signer::address_of(&account));
        let listing = vector::borrow(&market.listings, 0);
        assert!(listing.status == LISTING_PENDING, 2003);
        assert!(listing.buyer == signer::address_of(&buyer), 2004);
    }

    #[test(account = @gec, intruder = @0x456)]
    #[expected_failure(abort_code = E_NOT_LISTING_OWNER)]
    public entry fun test_non_owner_cancel_aborts(account: signer, intruder: signer) acquires Marketplace {
        initialize_marketplace(&account);
        list_certificate(&account, signer::address_of(&account), 4, 90);
        cancel_listing(&intruder, signer::address_of(&account), 1);
    }
}
