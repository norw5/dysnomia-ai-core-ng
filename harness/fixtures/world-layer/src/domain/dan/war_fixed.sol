// SPDX-License-Identifier: Sharia
pragma solidity ^0.8.21;
import "../../01_dysnomia_v2.sol";
import "../interfaces/worldinterface.sol";
import "../assets/h2o.sol";

// Fixture-fixed variants of domain/dan/04_war.sol + domain/assets/h2o.sol
// (session 58; the WAR half of the world-layer fixed stack).
//
// The verbatim WAR is UNDEPLOYABLE for the same reason as WORLD: its
// constructor does `new H2O(address(this))` and H2O's constructor calls back
// into the parent-under-construction (`DYSNOMIA(WarAddress).Xiao()` AND
// `War.World().Cheon()...`) — empty code, bare revert, creation fails.
//
// FIXES (marked inline): H2OFIXED takes the live math address as a parameter
// and skips the addOwner callback (WARFIXED performs it once H2O exists —
// same ownership end-state, no under-construction call).

contract H2OFIXED is DYSNOMIA {
    string public constant Type = "H2O";

    WARINTERFACE public War;

    // FIX: verbatim H2O(address) derives Xiao by calling BACK into the
    // deploying WAR (under construction — empty code). The fixed constructor
    // takes the live math address as a parameter.
    constructor(address WarAddress, address MathAddress) DYSNOMIA(unicode"水", "H2O", MathAddress) {
        maxSupply = 0;

        War = WARINTERFACE(WarAddress);
        // FIX: the CHAN addOwner moves to WARFIXED's constructor (this
        // contract's parent does not exist as code yet)

        DYSNOMIA calltoken = DYSNOMIA(CallContract);
        _mint(address(this), calltoken.totalSupply());
        _addMarketRate(CallContract, 1 * 10 ** decimals());

        _mintToCap();
    }

    function Balance() public view returns (uint256) {
        (YUEINTERFACE Yue, ) = War.World().Cheon().Sei().Chi();
        return H2OFIXED(address(this)).balanceOf(address(Yue));
    }

    function Mint(address To, uint256 Amount) public onlyOwners {
        _mint(To, Amount);
        uint256 _flip = H2OFIXED(address(this)).balanceOf(To);
        uint256 _max = War.World().Map().Map().Meridians(13);
        if(_flip > _max) {
            uint256 _flip2 = H2OFIXED(address(this)).balanceOf(address(War.World()));
            uint256 _max2 = War.World().Map().Map().Meridians(20);

            if(_flip2 < _max2)
                _transfer(To, address(War.World()), _flip - _max);
            else
                _transfer(To, address(0x0), _flip - _max);
        }
    }
}

contract WARFIXED is DYSNOMIA {
    string public constant Type = "WAR";

    WORLDINTERFACE public World;
    H2OFIXED public Water;
    uint256 public CO2;

    mapping(address Caude => mapping(uint256 Position => uint256 Carbon)) private _taan;

    constructor(address WorldAddress) DYSNOMIA("Dysnomia War", "WAR", address(DYSNOMIA(WorldAddress).Xiao())) {
        World = WORLDINTERFACE(WorldAddress);
        World.Cheon().Sei().Chan().addOwner(address(this));

        // FIX: deploy the fixed H2O (the verbatim one reverts calling back
        // into this contract while it is under construction), then perform
        // its CHAN ownership wiring from here
        Water = new H2OFIXED(address(this), address(Xiao));
        World.Cheon().Sei().Chan().addOwner(address(Water));

        uint256 originMint = Xiao.Random() % maxSupply / 10;
        _mint(tx.origin, originMint * 10 ** decimals());

        _addMarketRate(AFFECTIONContract, 1 * 10 ** decimals());
        _addMarketRate(WorldAddress, 1 * 10 ** decimals());
    }

    function Faa(address Caude, uint256 Position) public returns (uint256 Waat) {
        uint256 Buzz = World.Tail(Caude, Position);
        if(Buzz == 0) return 0;
        (YUEINTERFACE Chi, ) = World.Cheon().Sei().Chi();
        (uint256 Phoebe, uint256 Iota, uint256 Chao, uint256 Charge) = World.Meta().Ring().Eta();

        Waat = Xiao.modExp(Phoebe, Charge, World.Map().Map().Meridians(89));

        if(Waat > _taan[Caude][Position]) {
            Water.Mint(address(Chi), Iota);
            CO2 += Chao;
        }
    }
}
