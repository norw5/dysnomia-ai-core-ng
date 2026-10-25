// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// The forced-LATE-revert asset for harness set-2 step 11 (session-51).
///
/// MAP.New's pipeline: duplicate/forbid/derivative checks -> CHO.Luo() draw
/// (the Qu claim) -> QING deploy -> `if(has(asset,"name()") && has(asset,
/// "symbol()")) Mu.Rename(concat(Asset.name(), " QING"), ...)`.
///
/// EvilAsset's name()/symbol() SUCCEED as staticcalls but return EMPTY
/// returndata: MAP.has() probing sees them as working (any successful
/// staticcall counts), yet the high-level Asset.name() decode inside the
/// rename step reverts — AFTER the draw. That forces the exact late-revert
/// shape the Qu-claim leak observation needs, without touching any other
/// leg (no owner()/Waat() => the guarded branches skip; unknown selectors
/// revert => has() probing stays honest).
contract EvilAsset {
    uint8 public constant decimals = 18;
    uint256 public totalSupply = 1_000_000 ether;
    mapping(address => uint256) public balanceOf;

    constructor() {
        balanceOf[msg.sender] = totalSupply;
    }

    function name() external pure returns (string memory) {
        assembly {
            return(0, 0)
        }
    }

    function symbol() external pure returns (string memory) {
        assembly {
            return(0, 0)
        }
    }
}
