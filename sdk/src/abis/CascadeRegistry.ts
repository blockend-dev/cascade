// GENERATED FILE — do not hand-edit. Source of truth: contracts/artifacts/src/CascadeRegistry.sol/CascadeRegistry.json (Hardhat's own compiled output).
// Regenerate with `npm run generate-abis` after any contract change — see ADR 0012.

export const CASCADE_REGISTRY_ABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "initialResolver",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "ChallengeWindowClosed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ChallengeWindowOpen",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "CycleDetected",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EdgeAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EdgeNotChallenged",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EdgeNotFound",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EdgeNotPending",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InsufficientChallengeBond",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InsufficientStake",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ModelAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ModelNotActive",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ModelNotFound",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotModelOwner",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotResolver",
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
    "name": "ReentrancyGuardReentrantCall",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "RoyaltyCapExceeded",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SelfParent",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TooManyParents",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TransferFailed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAddress",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "edgeId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "challenger",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "bond",
        "type": "uint256"
      }
    ],
    "name": "LineageEdgeChallenged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "edgeId",
        "type": "bytes32"
      }
    ],
    "name": "LineageEdgeFinalized",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "edgeId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "childModelId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "parentModelId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "enum CascadeRegistry.ConfidenceLevel",
        "name": "confidenceLevel",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "royaltyBps",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "stake",
        "type": "uint256"
      }
    ],
    "name": "LineageEdgeRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "edgeId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "challengeUpheld",
        "type": "bool"
      }
    ],
    "name": "LineageEdgeResolved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "modelId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "metadataURI",
        "type": "string"
      }
    ],
    "name": "ModelMetadataUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "modelId",
        "type": "bytes32"
      },
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
    "name": "ModelOwnershipTransferred",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "modelId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "modelCommitment",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "metadataURI",
        "type": "string"
      }
    ],
    "name": "ModelRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "modelId",
        "type": "bytes32"
      }
    ],
    "name": "ModelRevoked",
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
        "name": "resolver",
        "type": "address"
      }
    ],
    "name": "ResolverUpdated",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "BPS_DENOMINATOR",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "challengeBondAmount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "edgeId",
        "type": "bytes32"
      }
    ],
    "name": "challengeEdge",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "challengeWindow",
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
        "internalType": "bytes32",
        "name": "childModelId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "parentModelId",
        "type": "bytes32"
      }
    ],
    "name": "computeEdgeId",
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
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "edgeExists",
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
        "internalType": "bytes32",
        "name": "edgeId",
        "type": "bytes32"
      }
    ],
    "name": "finalizeEdge",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "edgeId",
        "type": "bytes32"
      }
    ],
    "name": "getEdge",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "childModelId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "parentModelId",
            "type": "bytes32"
          },
          {
            "internalType": "enum CascadeRegistry.ConfidenceLevel",
            "name": "confidenceLevel",
            "type": "uint8"
          },
          {
            "internalType": "uint16",
            "name": "royaltyBps",
            "type": "uint16"
          },
          {
            "internalType": "bytes32",
            "name": "evidenceHash",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "stake",
            "type": "uint256"
          },
          {
            "internalType": "uint64",
            "name": "challengeDeadline",
            "type": "uint64"
          },
          {
            "internalType": "enum CascadeRegistry.EdgeStatus",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "address",
            "name": "challenger",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "challengeBond",
            "type": "uint256"
          }
        ],
        "internalType": "struct CascadeRegistry.LineageEdge",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "modelId",
        "type": "bytes32"
      }
    ],
    "name": "getModel",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "owner",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "modelCommitment",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "metadataURI",
            "type": "string"
          },
          {
            "internalType": "enum CascadeRegistry.ModelStatus",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "uint64",
            "name": "createdAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct CascadeRegistry.Model",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "childModelId",
        "type": "bytes32"
      }
    ],
    "name": "getParentEdgeIds",
    "outputs": [
      {
        "internalType": "bytes32[]",
        "name": "",
        "type": "bytes32[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxDepth",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxParentBps",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxParentsPerModel",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "minStake",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
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
    "name": "modelExists",
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
    "inputs": [
      {
        "internalType": "bytes32[]",
        "name": "edgeIds",
        "type": "bytes32[]"
      }
    ],
    "name": "pathConfidence",
    "outputs": [
      {
        "internalType": "enum CascadeRegistry.ConfidenceLevel",
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
        "internalType": "bytes32",
        "name": "childModelId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "parentModelId",
        "type": "bytes32"
      },
      {
        "internalType": "enum CascadeRegistry.ConfidenceLevel",
        "name": "confidenceLevel",
        "type": "uint8"
      },
      {
        "internalType": "uint16",
        "name": "royaltyBps",
        "type": "uint16"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "registerLineageEdge",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "edgeId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "modelCommitment",
        "type": "bytes32"
      },
      {
        "internalType": "string",
        "name": "metadataURI",
        "type": "string"
      },
      {
        "internalType": "bytes32",
        "name": "salt",
        "type": "bytes32"
      }
    ],
    "name": "registerModel",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "modelId",
        "type": "bytes32"
      }
    ],
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
        "internalType": "bytes32",
        "name": "edgeId",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "challengeUpheld",
        "type": "bool"
      }
    ],
    "name": "resolveChallenge",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "resolver",
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
        "internalType": "bytes32",
        "name": "modelId",
        "type": "bytes32"
      }
    ],
    "name": "revokeModel",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "setChallengeBondAmount",
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
    "name": "setChallengeWindow",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "value",
        "type": "uint8"
      }
    ],
    "name": "setMaxDepth",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint16",
        "name": "value",
        "type": "uint16"
      }
    ],
    "name": "setMaxParentBps",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint16",
        "name": "value",
        "type": "uint16"
      }
    ],
    "name": "setMaxParentsPerModel",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "setMinStake",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newResolver",
        "type": "address"
      }
    ],
    "name": "setResolver",
    "outputs": [],
    "stateMutability": "nonpayable",
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
    "name": "totalParentBps",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "modelId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "transferModelOwnership",
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
        "internalType": "bytes32",
        "name": "modelId",
        "type": "bytes32"
      },
      {
        "internalType": "string",
        "name": "metadataURI",
        "type": "string"
      }
    ],
    "name": "updateMetadataURI",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
