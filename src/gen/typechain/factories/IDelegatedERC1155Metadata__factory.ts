/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import { Contract, Signer } from "ethers";
import { Provider } from "@ethersproject/providers";

import type { IDelegatedERC1155Metadata } from "../IDelegatedERC1155Metadata";

export class IDelegatedERC1155Metadata__factory {
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): IDelegatedERC1155Metadata {
    return new Contract(
      address,
      _abi,
      signerOrProvider
    ) as IDelegatedERC1155Metadata;
  }
}

const _abi = [
  {
    inputs: [],
    name: "metadataProvider",
    outputs: [
      {
        internalType: "contract IERC1155Metadata",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];
