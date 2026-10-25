// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

contract MockAsset {
    string public name = "Harness Asset";
    string public symbol = "HASS";
    uint8 public constant decimals = 18;
    uint256 public totalSupply = 1_000_000 ether;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor() {
        balanceOf[msg.sender] = totalSupply;
    }

    function transfer(address to, uint256 amount) public returns (bool) {
        unchecked {
            balanceOf[msg.sender] -= amount;
            balanceOf[to] += amount;
            return true;
        }
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        unchecked {
            allowance[from][msg.sender] -= amount;
            balanceOf[from] -= amount;
            balanceOf[to] += amount;
            return true;
        }
    }
}
