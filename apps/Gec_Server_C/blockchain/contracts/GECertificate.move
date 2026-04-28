module gec::gec_certificate {
    use aptos_framework::timestamp;
    use aptos_framework::event;
    use std::signer;
    use std::string::{Self, String};
    use std::vector;

    const E_ALREADY_INITIALIZED: u64 = 1;
    const E_NOT_INITIALIZED: u64 = 2;
    const E_NOT_REGISTRY_OWNER: u64 = 3;
    const E_NOT_AUTHORIZED_ISSUER: u64 = 4;
    const E_CERT_NOT_FOUND: u64 = 5;
    const E_NOT_CERT_OWNER: u64 = 6;
    const E_CERT_NOT_ACTIVE: u64 = 7;
    const E_DUPLICATE_RECORD: u64 = 8;

    const STATUS_ACTIVE: u8 = 1;
    const STATUS_RETIRED: u8 = 2;
    const STATUS_CANCELLED: u8 = 3;

    struct GECertificate has store, drop {
        id: u64,
        owner: address,
        previous_owner: address,
        issuer: address,
        device_id: String,
        device_name: String,
        energy_source: String,
        energy_amount: u64,
        prod_start: String,
        prod_end: String,
        location: String,
        status: u8,
        created_at: u64,
        retired_at: u64,
        face_value: u64,
    }

    struct Registry has key {
        owner: address,
        next_id: u64,
        issuers: vector<address>,
        certificates: vector<GECertificate>,
        issued_events: event::EventHandle<CertificateIssuedEvent>,
        transfer_events: event::EventHandle<CertificateTransferredEvent>,
        retire_events: event::EventHandle<CertificateRetiredEvent>,
    }

    struct CertificateIssuedEvent has drop, store {
        cert_id: u64,
        owner: address,
        issuer: address,
        energy_amount: u64,
    }

    struct CertificateTransferredEvent has drop, store {
        cert_id: u64,
        from: address,
        to: address,
    }

    struct CertificateRetiredEvent has drop, store {
        cert_id: u64,
        owner: address,
    }

    public entry fun init(account: &signer) {
        let account_addr = signer::address_of(account);
        assert!(!exists<Registry>(account_addr), E_ALREADY_INITIALIZED);

        move_to(
            account,
            Registry {
                owner: account_addr,
                next_id: 1,
                issuers: vector::empty<address>(),
                certificates: vector::empty<GECertificate>(),
                issued_events: event::new_event_handle<CertificateIssuedEvent>(account),
                transfer_events: event::new_event_handle<CertificateTransferredEvent>(account),
                retire_events: event::new_event_handle<CertificateRetiredEvent>(account),
            }
        );
    }

    public entry fun add_issuer(account: &signer, registry_addr: address, issuer: address) acquires Registry {
        let registry = borrow_global_mut<Registry>(registry_addr);
        assert!(signer::address_of(account) == registry.owner, E_NOT_REGISTRY_OWNER);

        if (!contains_address(&registry.issuers, issuer)) {
            vector::push_back(&mut registry.issuers, issuer);
        };
    }

    public entry fun remove_issuer(account: &signer, registry_addr: address, issuer: address) acquires Registry {
        let registry = borrow_global_mut<Registry>(registry_addr);
        assert!(signer::address_of(account) == registry.owner, E_NOT_REGISTRY_OWNER);

        let (found, index) = find_issuer_index(&registry.issuers, issuer);
        if (found) {
            vector::remove(&mut registry.issuers, index);
        };
    }

    public entry fun create_certificate_simple(
        account: &signer,
        registry_addr: address,
        owner: address,
        device_id: String,
        energy_source: String,
        prod_start: String,
        prod_end: String,
        energy_amount: u64,
        face_value: u64,
        location: String,
    ) acquires Registry {
        let registry = borrow_global_mut<Registry>(registry_addr);
        let sender = signer::address_of(account);

        assert!(is_authorized_issuer(registry, sender), E_NOT_AUTHORIZED_ISSUER);
        assert!(
            !has_duplicate_record(
                registry,
                &device_id,
                &energy_source,
                &prod_start,
                &prod_end,
                energy_amount,
                &location
            ),
            E_DUPLICATE_RECORD
        );

        let cert_id = registry.next_id;
        let cert = GECertificate {
            id: cert_id,
            owner,
            previous_owner: owner,
            issuer: sender,
            device_id,
            device_name: string::utf8(b"GEC Device"),
            energy_source,
            energy_amount,
            prod_start,
            prod_end,
            location,
            status: STATUS_ACTIVE,
            created_at: timestamp::now_seconds(),
            retired_at: 0,
            face_value,
        };

        registry.next_id = registry.next_id + 1;
        vector::push_back(&mut registry.certificates, cert);

        event::emit_event(
            &mut registry.issued_events,
            CertificateIssuedEvent {
                cert_id,
                owner,
                issuer: sender,
                energy_amount,
            },
        );
    }

    public entry fun transfer_certificate(
        account: &signer,
        registry_addr: address,
        cert_id: u64,
        recipient: address,
        _quantity: u64,
        _note: vector<u8>,
    ) acquires Registry {
        let registry = borrow_global_mut<Registry>(registry_addr);
        let cert = borrow_certificate_mut(registry, cert_id);
        let sender = signer::address_of(account);

        assert!(cert.owner == sender, E_NOT_CERT_OWNER);
        assert!(cert.status == STATUS_ACTIVE, E_CERT_NOT_ACTIVE);

        let from = cert.owner;
        cert.previous_owner = cert.owner;
        cert.owner = recipient;

        event::emit_event(
            &mut registry.transfer_events,
            CertificateTransferredEvent { cert_id, from, to: recipient },
        );
    }

    public entry fun claim_certificate(account: &signer, registry_addr: address, cert_id: u64) acquires Registry {
        let registry = borrow_global_mut<Registry>(registry_addr);
        let cert = borrow_certificate_mut(registry, cert_id);
        let sender = signer::address_of(account);

        assert!(cert.owner == sender, E_NOT_CERT_OWNER);
        assert!(cert.status == STATUS_ACTIVE, E_CERT_NOT_ACTIVE);

        cert.status = STATUS_RETIRED;
        cert.retired_at = timestamp::now_seconds();

        event::emit_event(
            &mut registry.retire_events,
            CertificateRetiredEvent { cert_id, owner: sender },
        );
    }

    public entry fun cancel_certificate(
        account: &signer,
        registry_addr: address,
        cert_id: u64,
        _beneficiary: String,
    ) acquires Registry {
        let registry = borrow_global_mut<Registry>(registry_addr);
        let cert = borrow_certificate_mut(registry, cert_id);
        let sender = signer::address_of(account);

        assert!(cert.owner == sender, E_NOT_CERT_OWNER);
        assert!(cert.status == STATUS_ACTIVE, E_CERT_NOT_ACTIVE);

        cert.status = STATUS_CANCELLED;
    }

    #[view]
    public fun get_bundle_quantity(registry_addr: address, cert_id: u64): u64 acquires Registry {
        let cert = borrow_certificate_ref(borrow_global<Registry>(registry_addr), cert_id);
        cert.energy_amount
    }

    #[view]
    public fun get_certificate(
        registry_addr: address,
        cert_id: u64,
    ): (
        u64,
        address,
        address,
        String,
        String,
        String,
        u64,
        String,
        String,
        String,
        u8,
        u64,
        address
    ) acquires Registry {
        let cert = borrow_certificate_ref(borrow_global<Registry>(registry_addr), cert_id);
        (
            cert.id,
            cert.owner,
            cert.previous_owner,
            clone_string(&cert.device_id),
            clone_string(&cert.device_name),
            clone_string(&cert.energy_source),
            cert.energy_amount,
            clone_string(&cert.prod_start),
            clone_string(&cert.prod_end),
            clone_string(&cert.location),
            cert.status,
            cert.created_at,
            cert.issuer
        )
    }

    fun is_authorized_issuer(registry: &Registry, actor: address): bool {
        actor == registry.owner || contains_address(&registry.issuers, actor)
    }

    fun contains_address(items: &vector<address>, actor: address): bool {
        let len = vector::length(items);
        let mut i = 0;
        while (i < len) {
            if (*vector::borrow(items, i) == actor) {
                return true
            };
            i = i + 1;
        };
        false
    }

    fun find_issuer_index(items: &vector<address>, actor: address): (bool, u64) {
        let len = vector::length(items);
        let mut i = 0;
        while (i < len) {
            if (*vector::borrow(items, i) == actor) {
                return (true, i)
            };
            i = i + 1;
        };
        (false, 0)
    }

    fun has_duplicate_record(
        registry: &Registry,
        device_id: &String,
        energy_source: &String,
        prod_start: &String,
        prod_end: &String,
        energy_amount: u64,
        location: &String,
    ): bool {
        let len = vector::length(&registry.certificates);
        let mut i = 0;
        while (i < len) {
            let cert = vector::borrow(&registry.certificates, i);
            if (
                cert.energy_amount == energy_amount &&
                string::bytes(&cert.device_id) == string::bytes(device_id) &&
                string::bytes(&cert.energy_source) == string::bytes(energy_source) &&
                string::bytes(&cert.prod_start) == string::bytes(prod_start) &&
                string::bytes(&cert.prod_end) == string::bytes(prod_end) &&
                string::bytes(&cert.location) == string::bytes(location)
            ) {
                return true
            };
            i = i + 1;
        };
        false
    }

    fun borrow_certificate_mut(registry: &mut Registry, cert_id: u64): &mut GECertificate {
        let len = vector::length(&registry.certificates);
        let mut i = 0;
        while (i < len) {
            let cert = vector::borrow_mut(&mut registry.certificates, i);
            if (cert.id == cert_id) {
                return cert
            };
            i = i + 1;
        };
        abort E_CERT_NOT_FOUND
    }

    fun borrow_certificate_ref(registry: &Registry, cert_id: u64): &GECertificate {
        let len = vector::length(&registry.certificates);
        let mut i = 0;
        while (i < len) {
            let cert = vector::borrow(&registry.certificates, i);
            if (cert.id == cert_id) {
                return cert
            };
            i = i + 1;
        };
        abort E_CERT_NOT_FOUND
    }

    fun clone_string(value: &String): String {
        string::utf8(vector::append(vector::empty<u8>(), *string::bytes(value)))
    }

    #[test(account = @gec)]
    public entry fun test_create_and_retire(account: signer) acquires Registry {
        init(&account);
        create_certificate_simple(
            &account,
            signer::address_of(&account),
            signer::address_of(&account),
            string::utf8(b"device-1"),
            string::utf8(b"solar"),
            string::utf8(b"2025-04-20T14:00:00Z"),
            string::utf8(b"2025-04-20T15:00:00Z"),
            100,
            1,
            string::utf8(b"Lahore"),
        );

        let cert = borrow_certificate_ref(borrow_global<Registry>(signer::address_of(&account)), 1);
        assert!(cert.energy_amount == 100, 1000);
        claim_certificate(&account, signer::address_of(&account), 1);
        let updated = borrow_certificate_ref(borrow_global<Registry>(signer::address_of(&account)), 1);
        assert!(updated.status == STATUS_RETIRED, 1001);
    }

    #[test(account = @gec)]
    public entry fun test_add_and_remove_issuer(account: signer) acquires Registry {
        init(&account);
        add_issuer(&account, signer::address_of(&account), @0x123);
        let registry = borrow_global<Registry>(signer::address_of(&account));
        assert!(contains_address(&registry.issuers, @0x123), 1002);
        remove_issuer(&account, signer::address_of(&account), @0x123);
        let updated = borrow_global<Registry>(signer::address_of(&account));
        assert!(!contains_address(&updated.issuers, @0x123), 1003);
    }

    #[test(account = @gec)]
    public entry fun test_transfer_updates_previous_owner(account: signer) acquires Registry {
        init(&account);
        create_certificate_simple(
            &account,
            signer::address_of(&account),
            signer::address_of(&account),
            string::utf8(b"device-2"),
            string::utf8(b"wind"),
            string::utf8(b"2025-04-20T16:00:00Z"),
            string::utf8(b"2025-04-20T17:00:00Z"),
            150,
            1,
            string::utf8(b"Karachi"),
        );

        transfer_certificate(
            &account,
            signer::address_of(&account),
            1,
            @0x123,
            150,
            b"transfer"
        );

        let cert = borrow_certificate_ref(borrow_global<Registry>(signer::address_of(&account)), 1);
        assert!(cert.previous_owner == signer::address_of(&account), 1004);
        assert!(cert.owner == @0x123, 1005);
    }

    #[test(account = @gec)]
    public entry fun test_cancel_marks_certificate_cancelled(account: signer) acquires Registry {
        init(&account);
        create_certificate_simple(
            &account,
            signer::address_of(&account),
            signer::address_of(&account),
            string::utf8(b"device-3"),
            string::utf8(b"hydro"),
            string::utf8(b"2025-04-20T18:00:00Z"),
            string::utf8(b"2025-04-20T19:00:00Z"),
            90,
            1,
            string::utf8(b"Islamabad"),
        );

        cancel_certificate(
            &account,
            signer::address_of(&account),
            1,
            string::utf8(b"manual cancel")
        );

        let cert = borrow_certificate_ref(borrow_global<Registry>(signer::address_of(&account)), 1);
        assert!(cert.status == STATUS_CANCELLED, 1006);
    }

    #[test(account = @gec)]
    #[expected_failure(abort_code = E_DUPLICATE_RECORD)]
    public entry fun test_duplicate_certificate_create_aborts(account: signer) acquires Registry {
        init(&account);
        create_certificate_simple(
            &account,
            signer::address_of(&account),
            signer::address_of(&account),
            string::utf8(b"device-4"),
            string::utf8(b"solar"),
            string::utf8(b"2025-04-20T20:00:00Z"),
            string::utf8(b"2025-04-20T21:00:00Z"),
            60,
            1,
            string::utf8(b"Lahore"),
        );

        create_certificate_simple(
            &account,
            signer::address_of(&account),
            signer::address_of(&account),
            string::utf8(b"device-4"),
            string::utf8(b"solar"),
            string::utf8(b"2025-04-20T20:00:00Z"),
            string::utf8(b"2025-04-20T21:00:00Z"),
            60,
            1,
            string::utf8(b"Lahore"),
        );
    }

    #[test(account = @gec, intruder = @0x456)]
    #[expected_failure(abort_code = E_NOT_CERT_OWNER)]
    public entry fun test_non_owner_transfer_aborts(account: signer, intruder: signer) acquires Registry {
        init(&account);
        create_certificate_simple(
            &account,
            signer::address_of(&account),
            signer::address_of(&account),
            string::utf8(b"device-5"),
            string::utf8(b"biomass"),
            string::utf8(b"2025-04-20T22:00:00Z"),
            string::utf8(b"2025-04-20T23:00:00Z"),
            45,
            1,
            string::utf8(b"Quetta"),
        );

        transfer_certificate(
            &intruder,
            signer::address_of(&account),
            1,
            @0x789,
            45,
            b"forbidden"
        );
    }
}
