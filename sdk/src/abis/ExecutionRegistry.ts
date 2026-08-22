// GENERATED FILE — do not hand-edit. Source of truth: contracts/artifacts/src/ExecutionRegistry.sol/ExecutionRegistry.json (Hardhat's own compiled output).
// Regenerate with `npm run generate-abis` after any contract change — see ADR 0012.

export const EXECUTION_REGISTRY_ABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "cascadeRegistryAddress",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "ECDSAInvalidSignature",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "length",
        "type": "uint256"
      }
    ],
    "name": "ECDSAInvalidSignatureLength",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "s",
        "type": "bytes32"
      }
    ],
    "name": "ECDSAInvalidSignatureS",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ExecutionAlreadyConsumed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidShortString",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ModelCommitmentMismatch",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotSignerOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "OwnableInvalidOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "OwnableUnauthorizedAccount",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ProofExpired",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ProofNotYetValid",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SignerAlreadyRegistered",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "str",
        "type": "string"
      }
    ],
    "name": "StringTooLong",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "UnregisteredSigner",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAddress",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [],
    "name": "EIP712DomainChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "previousOwner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "OwnershipTransferred",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "ParameterUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "provider",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "enum ExecutionRegistry.ProviderMode",
        "name": "mode",
        "type": "uint8"
      }
    ],
    "name": "ProviderModeUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "provider",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "signer",
        "type": "address"
      }
    ],
    "name": "SignerRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "provider",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "signer",
        "type": "address"
      }
    ],
    "name": "SignerRevoked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "executionId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "provider",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "modelId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "requestHash",
        "type": "bytes32"
      }
    ],
    "name": "UsageProofConsumed",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "USAGE_PROOF_TYPEHASH",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "cascadeRegistry",
    "outputs": [
      {
        "internalType": "contract CascadeRegistry",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "modelId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "modelCommitment",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "requestHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "responseHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "chatId",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "epoch",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "issuedAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct ExecutionRegistry.UsageProof",
        "name": "proof",
        "type": "tuple"
      },
      {
        "internalType": "bytes",
        "name": "signature",
        "type": "bytes"
      }
    ],
    "name": "consumeUsageProof",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "signer",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "provider",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "modelId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "executionId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "requestHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "responseHash",
            "type": "bytes32"
          },
          {
            "internalType": "enum CascadeRegistry.ConfidenceLevel",
            "name": "servingConfidence",
            "type": "uint8"
          }
        ],
        "internalType": "struct ExecutionRegistry.VerifiedUsage",
        "name": "usage",
        "type": "tuple"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "eip712Domain",
    "outputs": [
      {
        "internalType": "bytes1",
        "name": "fields",
        "type": "bytes1"
      },
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "version",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "chainId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "verifyingContract",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "salt",
        "type": "bytes32"
      },
      {
        "internalType": "uint256[]",
        "name": "extensions",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "executionConsumed",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "provider",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "modelId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "requestHash",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "responseHash",
        "type": "bytes32"
      }
    ],
    "name": "hashExecutionId",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "modelId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "modelCommitment",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "requestHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "responseHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "chatId",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "epoch",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "issuedAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct ExecutionRegistry.UsageProof",
        "name": "proof",
        "type": "tuple"
      }
    ],
    "name": "hashTypedDataDigest",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "modelId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "modelCommitment",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "requestHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "responseHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "chatId",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "epoch",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "issuedAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct ExecutionRegistry.UsageProof",
        "name": "proof",
        "type": "tuple"
      }
    ],
    "name": "hashUsageProof",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "proofValidityWindow",
    "outputs": [
      {
        "internalType": "uint64",
        "name": "",
        "type": "uint64"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "providerMode",
    "outputs": [
      {
        "internalType": "enum ExecutionRegistry.ProviderMode",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "providerOfSigner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "signerAddress",
        "type": "address"
      }
    ],
    "name": "registerSigner",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "renounceOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "signerAddress",
        "type": "address"
      }
    ],
    "name": "revokeSigner",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "value",
        "type": "uint64"
      }
    ],
    "name": "setProofValidityWindow",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "provider",
        "type": "address"
      },
      {
        "internalType": "enum ExecutionRegistry.ProviderMode",
        "name": "mode",
        "type": "uint8"
      }
    ],
    "name": "setProviderMode",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "modelId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "modelCommitment",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "requestHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "responseHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "chatId",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "epoch",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "issuedAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct ExecutionRegistry.UsageProof",
        "name": "proof",
        "type": "tuple"
      },
      {
        "internalType": "bytes",
        "name": "signature",
        "type": "bytes"
      }
    ],
    "name": "verifyUsageProof",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "signer",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "provider",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "modelId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "executionId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "requestHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "responseHash",
            "type": "bytes32"
          },
          {
            "internalType": "enum CascadeRegistry.ConfidenceLevel",
            "name": "servingConfidence",
            "type": "uint8"
          }
        ],
        "internalType": "struct ExecutionRegistry.VerifiedUsage",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
