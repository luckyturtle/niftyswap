"use strict";
/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
exports.__esModule = true;
exports.IDelegatedERC1155Metadata__factory = void 0;
var ethers_1 = require("ethers");
var IDelegatedERC1155Metadata__factory = /** @class */ (function () {
    function IDelegatedERC1155Metadata__factory() {
    }
    IDelegatedERC1155Metadata__factory.connect = function (address, signerOrProvider) {
        return new ethers_1.Contract(address, _abi, signerOrProvider);
    };
    return IDelegatedERC1155Metadata__factory;
}());
exports.IDelegatedERC1155Metadata__factory = IDelegatedERC1155Metadata__factory;
var _abi = [
    {
        inputs: [],
        name: "metadataProvider",
        outputs: [
            {
                internalType: "contract IERC1155Metadata",
                name: "",
                type: "address"
            },
        ],
        stateMutability: "view",
        type: "function"
    },
];
