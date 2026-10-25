// SPDX-License-Identifier: Sharia
pragma solidity ^0.8.21;
import "../01_dysnomia_v2.sol";
import "./tang/interfaces/02b_cheoninterface.sol";
import "./tang/interfaces/03b_metainterface.sol";
import "./interfaces/mapinterface.sol";
import "./assets/vitus.sol";

// Fixture-fixed variants of domain/world.sol + domain/assets/vitus.sol
// (session 58, owner round: DSS-precedent verbatim + patched pair).
//
// The verbatim WORLD is UNDEPLOYABLE as written: its constructor does
// `new VITUS(address(this))`, and VITUS's constructor calls back into the
// parent-under-construction (`DYSNOMIA(WorldAddress).Xiao()` and
// `World.Cheon()...`) — empty code there, so the abi-decode reverts bare and
// the whole creation reverts (fork-proven: empty revert data). This is the
// likely cause of the failed wave-5 create (kb/dev/world.md: "produced NO
// code; why, is unknown").
//
// The verbatim WORLD additionally never writes `_cauda`, so Tail() is always
// 0, WAR.Faa always returns 0 and GWAT.Gwat always reverts SpawningFailure —
// the designed claim->draw->spawn loop is unwired in the recovered source.
//
// FIXES (marked inline): the constructor-callback pair (VITUSFIXED takes the
// live addresses as params; WORLDFIXED passes them) + the one-line cauda
// write in Code.

contract VITUSFIXED is DYSNOMIA {
    string public constant Type = "VITUS";

    WORLDINTERFACE public World;

    // FIX: verbatim VITUS(address) derives Xiao and Cheon by calling BACK
    // into the deploying WORLD (under construction — empty code). The fixed
    // constructor takes the live math + cheon addresses as parameters.
    constructor(address WorldAddress, address CheonAddress, address MathAddress) DYSNOMIA("Dysnomia Creators", "VITUS", MathAddress) {
        maxSupply = 0;

        World = WORLDINTERFACE(WorldAddress);
        CHEON(CheonAddress).Sei().Chan().addOwner(address(this));
        // NOTE (fork-found): the verbatim royalty exit (Withdraw -> CHAN ->
        // YUE.Withdraw) is dead ON THE LIVE LAYER regardless of ownership:
        // the YUE's hasMint probe staticcalls keccak("Mint(address, uint256)")
        // — WITH A SPACE — selector 0x7a2dd71a, which no contract answers, so
        // OnlyGameTokens fires for EVERY asset. Recorded as the kb correction;
        // no ownership patch can wire it (kept out deliberately).

        DYSNOMIA wmtoken = DYSNOMIA(WMContract);
        _mint(address(this), wmtoken.totalSupply());
        _addMarketRate(WMContract, 1 * 10 ** decimals());

        _mintToCap();
    }

    function Withdraw(uint256 Amount) public {
        (YUEINTERFACE Yue, ) = World.Cheon().Sei().Chi();
        World.Cheon().Sei().Chan().YueWithdraw(Yue, address(this), msg.sender, Amount);
    }

    function Balance() public view returns (uint256) {
        (YUEINTERFACE Yue, ) = World.Cheon().Sei().Chi();
        return VITUSFIXED(address(this)).balanceOf(address(Yue));
    }

    function Mint(address To, uint256 Amount) public onlyOwners {
        _mint(To, Amount);
        uint256 _flip = VITUSFIXED(address(this)).balanceOf(To);
        uint256 _max = World.Map().Map().Meridians(13);
        if(_flip > _max) {
            uint256 _flip2 = VITUSFIXED(address(this)).balanceOf(address(World));
            uint256 _max2 = World.Map().Map().Meridians(20);

            if(_flip2 < _max2)
                _transfer(To, address(World), _flip - _max);
            else
                _transfer(To, address(0x0), _flip - _max);
        }
    }
}

contract WORLDFIXED is DYSNOMIA {
    string public constant Type = "WORLDFIXED";

    CHEON public Cheon;
    META public Meta;
    VITUSFIXED public Vitus;
    MAPINTERFACE public Map;

    mapping(int256 Latitude => mapping(int256 Longitude => mapping(address Caude => uint256 Bun))) private _world;
    mapping(address Caude => int256[] Latitudes) private _cauda;
    mapping(int256 Latitude => address[] Coders) private _creation;
    mapping(int256 Latitude => mapping(address Coder => mapping(address Caude => uint256 Buzz))) private _creators;
    mapping(address Caude => mapping(address Distributive => bool Allowed)) private _whitelist;

    constructor(address CheonAddress, address MetaAddress, address MapAddress) DYSNOMIA("Dysnomia World", "WORLD", address(DYSNOMIA(CheonAddress).Xiao())) {
        Cheon = CHEON(CheonAddress);
        Meta = META(MetaAddress);
        Map = MAPINTERFACE(MapAddress);

        uint256 originMint = Xiao.Random() % maxSupply / 10;
        _mint(tx.origin, originMint * 10 ** decimals());

        _addMarketRate(AFFECTIONContract, 1 * 10 ** decimals());
        _addMarketRate(CheonAddress, 1 * 10 ** decimals());
        _addMarketRate(MetaAddress, 1 * 10 ** decimals());
        _addMarketRate(MapAddress, 1 * 10 ** decimals());

        // FIX: deploy the fixed VITUS (the verbatim one reverts calling back
        // into this contract while it is under construction). The verbatim
        // `Vitus.Mint(address(this), 1)` (a 1-wei initial unit) is DROPPED:
        // Mint's overflow check reads World.Map() — the same under-
        // construction callback class; the MV 1:1 seed is what matters.
        Vitus = new VITUSFIXED(address(this), CheonAddress, address(Xiao));
    }

    function Whitelist(address Caude, address Distributive, bool Allow) public {
        QINGINTERFACE Asset = QINGINTERFACE(Caude);
        if((owner(msg.sender)) || (Asset.owner(msg.sender)))
            _whitelist[Caude][Distributive] = Allow;
    }

    function Tail(address Caude, uint256 Position) public view returns (uint256 Bid) {
        for(uint i = 0; i < _cauda[Caude].length; i++) {
            if(Position > _creation[_cauda[Caude][i]].length)
                Position = Position - _creation[_cauda[Caude][i]].length;
            else {
                return _creators[_cauda[Caude][i]][_creation[_cauda[Caude][i]][Position - 1]][Caude];
            }
        }
        return 0;
    }

    function Bun(int256 Latitude, int256 Longitude, address Caude) public view returns (uint256) {
        return _world[Latitude][Longitude][Caude];
    }

    function Buzz(int256 Latitude, address Coder, address Caude) public view returns (uint256) {
        return _creators[Latitude][Coder][Caude];
    }

    function Distribute(address Caude, address Distributive, uint256 Amount) public returns (uint256 Remaining) {
        address _c;
        uint256 _pdist;
        uint256 Charge;
        if(_whitelist[Caude][address(0x0)] == false)
            if(_whitelist[Caude][Distributive] == false) return Amount;

        for(uint256 i = 0; i < _cauda[Caude].length; i++) {
            if(Amount <= 1111111111) return Amount;
            _pdist = Amount / (_cauda[Caude].length - i) / _creation[_cauda[Caude][i]].length;
            if(_pdist <= 1111111111) continue;
            for(uint256 j = 0; j < _creation[_cauda[Caude][i]].length; j++) {
                _c = _creation[_cauda[Caude][i]][j];
                Charge = _creators[_cauda[Caude][i]][_c][Caude] % _pdist;
                if(Charge == 0) continue;
                DYSNOMIA(Distributive).transferFrom(msg.sender, _c, Charge);
                unchecked {
                    Amount -= Charge;
                    _creators[_cauda[Caude][i]][_c][Caude] -= Charge;
                }
            }
        }
        return Amount;
    }

    error OutOfRange(int256 QingLatitude, int256 QingLongitude, uint256 Range);
    function Code(int256 Latitude, int256 Longitude, address Cause) public {
        uint256 QingWaat = QINGINTERFACE(Cause).Waat();
        QINGINTERFACE Qing = Map.GetQing(QingWaat);
        assert(Cause == address(Qing));
        (YUEINTERFACE Chi, ) = Cheon.Sei().Chi();
        (uint256 Charge, uint256 Hypobar, ) = Cheon.Su(Cause);
        (uint256 Dione, , uint256 Deimos, uint256 Yeo) = Meta.Beat(QingWaat);
        (int256 qlat, int256 qlon) = Map.Map().Compliment(QingWaat);

        if(Latitude > qlat + int256(Yeo)) revert OutOfRange(qlat, qlon, Yeo);
        if(Latitude < qlat - int256(Yeo)) revert OutOfRange(qlat, qlon, Yeo);
        if(Longitude > qlon + int256(Yeo)) revert OutOfRange(qlat, qlon, Yeo);
        if(Longitude < qlon - int256(Yeo)) revert OutOfRange(qlat, qlon, Yeo);

        if(Charge == 0) return;
        if(Charge >= _world[Latitude][Longitude][Cause]) {
            _world[Latitude][Longitude][Cause] += Hypobar;
            Vitus.Mint(address(Chi), Dione);

            if(_creators[Latitude][address(Chi)][Cause] == 0)
                _creation[Latitude].push(address(Chi));
            _creators[Latitude][address(Chi)][Cause] += Deimos;
            // FIX: the verbatim source never writes _cauda, so Tail() is
            // always 0 and the WAR.Faa -> GWAT.Gwat spawn chain is dead.
            if(_cauda[Cause].length == 0 || _cauda[Cause][_cauda[Cause].length - 1] != Latitude)
                _cauda[Cause].push(Latitude);
        }
    }
}
