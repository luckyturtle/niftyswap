import * as ethers from 'ethers'

import {
  AbstractContract,
  expect,
  OpCodeError,
  RevertError,
  getSellTokenData20,
  getAddLiquidityData,
  getRemoveLiquidityData,
  getBuyTokenData,
} from './utils'

import * as utils from './utils'

import {
  ERC20TokenMock,
  ERC1155Mock,
  ERC1155RoyaltyMock,
  ERC1155PackedBalanceMock,
  NiftyswapExchange20,
  NiftyswapFactory20
} from 'src/gen/typechain'

import { abi as exchangeABI } from '@0xsequence/niftyswap/artifacts/contracts/exchange/NiftyswapExchange20.sol/NiftyswapExchange20.json'
import { BigNumber } from 'ethers'
import { web3 } from 'hardhat'
import { ERC1155MetadataPrefix } from 'src/gen/typechain/ERC1155MetadataPrefix'

const exchangeIface = new ethers.utils.Interface(exchangeABI)

// init test wallets from package.json mnemonic

const { wallet: ownerWallet, provider: ownerProvider, signer: ownerSigner } = utils.createTestWallet(web3, 0)

const { wallet: userWallet, provider: userProvider, signer: userSigner } = utils.createTestWallet(web3, 2)

const { wallet: operatorWallet, provider: operatorProvider, signer: operatorSigner } = utils.createTestWallet(web3, 4)

const { wallet: randomWallet, provider: randomProvider, signer: randomSigner } = utils.createTestWallet(web3, 5)

const getBig = (id: number) => BigNumber.from(id)

describe('NiftyswapExchange20', () => {
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

  let ownerAddress: string
  let userAddress: string
  let operatorAddress: string
  let randomAddress: string
  let extraFeeRecipient: string
  let erc20Abstract: AbstractContract
  let erc1155Abstract: AbstractContract
  let erc1155RoyaltyAbstract: AbstractContract
  let erc1155PackedAbstract: AbstractContract
  let niftyswapFactoryAbstract: AbstractContract
  let erc1155MetadataPrefixAbstract: AbstractContract

  // ERC-1155 token
  let ownerERC1155Contract: ERC1155Mock | ERC1155RoyaltyMock
  let userERC1155Contract: ERC1155Mock | ERC1155RoyaltyMock
  let operatorERC1155Contract: ERC1155Mock | ERC1155RoyaltyMock

  // Currency
  let ownerCurrencyContract: ERC20TokenMock
  let userCurrencyContract: ERC20TokenMock
  let operatorCurrencyContract: ERC20TokenMock

  let niftyswapFactoryContract: NiftyswapFactory20
  let niftyswapExchangeContract: NiftyswapExchange20
  let userExchangeContract: NiftyswapExchange20
  let operatorExchangeContract: NiftyswapExchange20

  // Token Param
  const nTokenTypes = 30 //560
  const nTokensPerType = 500000

  // Currency Param
  const currencyAmount = BigNumber.from(10000000).mul(BigNumber.from(10).pow(18))

  // Fees param
  let LP_FEE
  let LP_FEE_MULTIPLIER
  const ROYALTY_FEE = 200               // 2%
  const EXTRA_FEE = 66667777            // flat fee

  // Add liquidity data
  const tokenAmountToAdd = BigNumber.from(300)
  const currencyAmountToAdd = BigNumber.from(10)
    .pow(18)
    .mul(299)

  // Transactions parameters
  const TX_PARAM = { gasLimit: 5000000 }
  const deadline = Math.floor(Date.now() / 1000) + 100000

  // Arrays
  const types = new Array(nTokenTypes).fill('').map((a, i) => getBig(i))
  const values = new Array(nTokenTypes).fill('').map((a, i) => nTokensPerType)
  const currencyAmountsToAdd: BigNumber[] = new Array(nTokenTypes).fill('').map((a, i) => currencyAmountToAdd)
  const tokenAmountsToAdd: BigNumber[] = new Array(nTokenTypes).fill('').map((a, i) => tokenAmountToAdd)
  const addLiquidityData: string = getAddLiquidityData(currencyAmountsToAdd, deadline)

  // load contract abi and deploy to test server
  before(async () => {
    ownerAddress = await ownerWallet.getAddress()
    userAddress = await userWallet.getAddress()
    operatorAddress = await operatorWallet.getAddress()
    randomAddress = await randomWallet.getAddress()
    extraFeeRecipient = ethers.Wallet.createRandom().address
    erc20Abstract = await AbstractContract.fromArtifactName('ERC20TokenMock')
    erc1155Abstract = await AbstractContract.fromArtifactName('ERC1155Mock')
    erc1155RoyaltyAbstract = await AbstractContract.fromArtifactName('ERC1155RoyaltyMock')
    erc1155PackedAbstract = await AbstractContract.fromArtifactName('ERC1155PackedBalanceMock')
    niftyswapFactoryAbstract = await AbstractContract.fromArtifactName('NiftyswapFactory20')
    erc1155MetadataPrefixAbstract = await AbstractContract.fromArtifactName('ERC1155MetadataPrefix')
  })

  let conditions = [
    ['Regular ERC1155 Token', 1],
    ['Packed Balance ERC1155 Token', 2],
    ['ERC-2981 Token with 0% royalty', 3],
    ['ERC-2981 Token Contract with 2% royalty', 4],
    ['Regular Token Contract with 2% royalty', 5],
    ['ERC-2981 Token Contract with 2% royalty and fixed extra fee', 6],
    ['ERC-2981 Token Contract with 2% royalty and fixed extra fee with 10% LP fee', 7],
  ]

  let erc1155_error_prefix
  let royaltyFee

  // Extra fees
  let extraFee = BigNumber.from(0)
  let extraFeeArray: BigNumber[] = []
  let extraFeeRecipients: string[] = []

  conditions.forEach(function(condition) {
    context(condition[0] as string, () => {
      // deploy before each test, to reset state of contract
      beforeEach(async () => {
        // Deploy ERC-1155
        if (condition[1] == 1 || condition[1] == 5) {
          ownerERC1155Contract = (await erc1155Abstract.deploy(ownerWallet)) as ERC1155Mock
          operatorERC1155Contract = (await ownerERC1155Contract.connect(operatorSigner)) as ERC1155Mock
          userERC1155Contract = (await ownerERC1155Contract.connect(userSigner)) as ERC1155Mock
          erc1155_error_prefix = 'ERC1155#'
          royaltyFee = BigNumber.from(0)

        } else if (condition[1] == 2) {
          ownerERC1155Contract = (await erc1155PackedAbstract.deploy(ownerWallet)) as ERC1155PackedBalanceMock
          operatorERC1155Contract = (await ownerERC1155Contract.connect(operatorSigner)) as ERC1155PackedBalanceMock
          userERC1155Contract = (await ownerERC1155Contract.connect(userSigner)) as ERC1155PackedBalanceMock
          erc1155_error_prefix = 'ERC1155PackedBalance#'
          royaltyFee = BigNumber.from(0)

        } else if (condition[1] == 3) {
          ownerERC1155Contract = (await erc1155RoyaltyAbstract.deploy(ownerWallet)) as ERC1155RoyaltyMock
          operatorERC1155Contract = (await ownerERC1155Contract.connect(operatorSigner)) as ERC1155RoyaltyMock
          userERC1155Contract = (await ownerERC1155Contract.connect(userSigner)) as ERC1155RoyaltyMock
          erc1155_error_prefix = 'ERC1155#'
          royaltyFee = BigNumber.from(0)
          
        } else if (condition[1] == 4 || condition[1] == 6 || condition[1] == 7) {
          ownerERC1155Contract = (await erc1155RoyaltyAbstract.deploy(ownerWallet)) as ERC1155RoyaltyMock
          operatorERC1155Contract = (await ownerERC1155Contract.connect(operatorSigner)) as ERC1155RoyaltyMock
          userERC1155Contract = (await ownerERC1155Contract.connect(userSigner)) as ERC1155RoyaltyMock
          royaltyFee = BigNumber.from(ROYALTY_FEE)

          // Set fee to 2% and fee recipient to operator
          await (ownerERC1155Contract as ERC1155RoyaltyMock).functions.setFee(200)
          await (ownerERC1155Contract as ERC1155RoyaltyMock).functions.setFeeRecipient(randomAddress)

          erc1155_error_prefix = 'ERC1155#'
        } 

        // Deploy Currency Token contract
        ownerCurrencyContract = (await erc20Abstract.deploy(ownerWallet)) as ERC20TokenMock
        userCurrencyContract = (await ownerCurrencyContract.connect(userSigner)) as ERC20TokenMock
        operatorCurrencyContract = (await ownerCurrencyContract.connect(operatorSigner)) as ERC20TokenMock

        // Deploy Niftyswap factory
        niftyswapFactoryContract = (await niftyswapFactoryAbstract.deploy(ownerWallet, [ownerAddress])) as NiftyswapFactory20

        if (condition[1] == 7) {
          LP_FEE = 100 // 10%
        } else {
          LP_FEE = 10 // 1%
        }
        LP_FEE_MULTIPLIER = 1000-LP_FEE // 1%

        // Create exchange contract for the ERC-20/1155 token
        await niftyswapFactoryContract.functions.createExchange(
          ownerERC1155Contract.address,
          ownerCurrencyContract.address,
          LP_FEE,
          0
        )

        // Retrieve exchange address
        const exchangeAddress = (
          await niftyswapFactoryContract.functions.tokensToExchange(
            ownerERC1155Contract.address,
            ownerCurrencyContract.address,
            LP_FEE,
            0
          )
        )[0]

        // Type exchange contract
        niftyswapExchangeContract = new ethers.Contract(exchangeAddress, exchangeABI, ownerWallet) as NiftyswapExchange20
        operatorExchangeContract = (await niftyswapExchangeContract.connect(operatorSigner)) as NiftyswapExchange20
        userExchangeContract = (await niftyswapExchangeContract.connect(userSigner)) as NiftyswapExchange20
        
        // Set royalty for condition 5
        if (condition[1] == 5) {
          royaltyFee = BigNumber.from(ROYALTY_FEE)
          await niftyswapExchangeContract.functions.setRoyaltyInfo(ROYALTY_FEE, randomAddress, {gasLimit: 8000000})
        }

        // Set extra fees for condition 6
        if (condition[1] == 6) {
          extraFee = BigNumber.from(EXTRA_FEE)
          extraFeeArray = [extraFee]
          extraFeeRecipients = [extraFeeRecipient]
        } else {
          extraFee = BigNumber.from(0)
          extraFeeArray = []
          extraFeeRecipients = []
        }

        // Mint Token to owner and user
        await ownerERC1155Contract.functions.batchMintMock(operatorAddress, types, values, [])
        await ownerERC1155Contract.functions.batchMintMock(userAddress, types, values, [])

        // Mint Currency token to owner and user
        await ownerCurrencyContract.functions.mockMint(operatorAddress, currencyAmount)
        await ownerCurrencyContract.functions.mockMint(userAddress, currencyAmount)

        // Authorize Niftyswap to transfer funds on your behalf for addLiquidity & transfers
        await operatorCurrencyContract.functions.approve(niftyswapExchangeContract.address, currencyAmount)
        await operatorERC1155Contract.functions.setApprovalForAll(niftyswapExchangeContract.address, true)
        await userCurrencyContract.functions.approve(niftyswapExchangeContract.address, currencyAmount)
        await userERC1155Contract.functions.setApprovalForAll(niftyswapExchangeContract.address, true)
      })

      describe('Getter functions', () => {
        describe('getTokenAddress() function', () => {
          it('should return token address', async () => {
            const token_address = await niftyswapExchangeContract.functions.getTokenAddress()
            await expect(token_address[0]).to.be.eql(ownerERC1155Contract.address)
          })
        })

        describe('getLPFee() function', () => {
          it('should return the LP fee', async () => {
            // With default LP fee
            const fee = await niftyswapExchangeContract.functions.getLPFee()
            await expect(fee[0]).to.be.eql(BigNumber.from(LP_FEE))

            // Create a new exchange with different LP fee
            await niftyswapFactoryContract.functions.createExchange(
              ownerERC1155Contract.address,
              ownerCurrencyContract.address,
              200,
              1
            )

            // Retrieve exchange address
            const exchangeAddress = (
              await niftyswapFactoryContract.functions.tokensToExchange(
                ownerERC1155Contract.address,
                ownerCurrencyContract.address,
                200,
                1
              )
            )[0]

            // Type exchange contract
            niftyswapExchangeContract = new ethers.Contract(exchangeAddress, exchangeABI, ownerWallet) as NiftyswapExchange20

            const fee2 = await niftyswapExchangeContract.functions.getLPFee()
            await expect(fee2[0]).to.be.eql(BigNumber.from(200))
          })
        })

        describe('getCurrencyInfo() function', () => {
          it('should return currency token address and ID', async () => {
            const token_info = await niftyswapExchangeContract.functions.getCurrencyInfo()
            await expect(token_info[0]).to.be.eql(ownerCurrencyContract.address)
          })
        })

        describe('getBuyPrice() function', () => {
          it('should round UP', async () => {
            let bought_amount = 100
            let sellReserve = 1500
            let buyReserve = 751

            // Calculate the price manually with floats
            const numerator = bought_amount * sellReserve * 1000
            const denominator =  (buyReserve - bought_amount) * LP_FEE_MULTIPLIER
            const floatPrice = numerator / denominator // Price without rounding

            // Get the price from the contract
            const price = await niftyswapExchangeContract.functions.getBuyPrice(bought_amount, sellReserve, buyReserve)
            expect(price[0]).to.be.eql(BigNumber.from(Math.ceil(floatPrice))) 
          })
        })

        describe('getSellPrice() function', () => {
          it('should round DOWN', async () => {
            let sold_amount = 100
            let buyReserve = 1500
            let sellReserve = 751 

            // Calculate price manually with floats
            const numerator = sold_amount * LP_FEE_MULTIPLIER * buyReserve
            const denominator =  sellReserve * 1000 + sold_amount * LP_FEE_MULTIPLIER
            const floatPrice = numerator / denominator // Price without rounding

            // Get the price from the contract directly
            const price = await niftyswapExchangeContract.functions.getSellPrice(sold_amount, sellReserve, buyReserve)
            expect(price[0]).to.be.eql(BigNumber.from(Math.floor(floatPrice))) 
          })
        })

        describe('getFactoryAddress() function', () => {
          it('should return factory address', async () => {
            const factory_address = await niftyswapExchangeContract.functions.getFactoryAddress()
            await expect(factory_address[0]).to.be.eql(niftyswapFactoryContract.address)
          })
        })

        describe('supportsInterface()', () => {
          it('should return true for 0x01ffc9a7 (IERC165)', async () => {
            const support = await niftyswapExchangeContract.functions.supportsInterface('0x01ffc9a7')
            expect(support[0]).to.be.eql(true)
          })

          it('should return true for 0x4e2312e0 (IERC1155Receiver)', async () => {
            const support = await niftyswapExchangeContract.functions.supportsInterface('0x4e2312e0')
            expect(support[0]).to.be.eql(true)
          })

          it('should return true for 0xd9b67a26 (IERC1155)', async () => {
            const support = await niftyswapExchangeContract.functions.supportsInterface('0xd9b67a26')
            expect(support[0]).to.be.eql(true)
          })

          it('should return true for 0x0e89341c (IERC1155 Metadata)', async () => {
            const support = await niftyswapExchangeContract.functions.supportsInterface('0x0e89341c')
            expect(support[0]).to.be.eql(true)
          })
        })
      })

      describe('_addLiquidity() function', () => {
        it('should pass when balances are sufficient', async () => {
          const tx = operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            types,
            tokenAmountsToAdd,
            addLiquidityData,
            { gasLimit: 50000000 }
          )
          await expect(tx).to.be.fulfilled
        })

        it('should ROUND UP the currency amount to be deposited on second deposit', async () => {
          let addLiquidityData1 = getAddLiquidityData([BigNumber.from(1000000001)], deadline)
          let tokenAmountsToAdd1 = [BigNumber.from(2)]

          // After 2nd deposit
          await operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            [0],
            tokenAmountsToAdd1,
            addLiquidityData1,
            { gasLimit: 50000000 }
          )

          let reserve1 = (await operatorExchangeContract.functions.getCurrencyReserves([0]))[0]
          expect(reserve1[0]).to.be.eql(BigNumber.from(1000000001))

          let addLiquidityData2 = getAddLiquidityData([BigNumber.from(1000000001)], deadline)
          let tokenAmountsToAdd2 = [BigNumber.from(1)] // 1 less

          // After 2nd deposit
          await operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            [0],
            tokenAmountsToAdd2,
            addLiquidityData2,
            { gasLimit: 50000000 }
          )

          let reserve2 = (await operatorExchangeContract.functions.getCurrencyReserves([0]))[0]
          expect(reserve2[0]).to.be.eql(BigNumber.from(1500000002)) // Should be 1500000001.5
        })

        it('should ROUND DOWN the amount of liquidity to mint on second deposit', async () => {
          let addLiquidityData1 = getAddLiquidityData([BigNumber.from(1000000001)], deadline)
          let tokenAmountsToAdd1 = [BigNumber.from(2)]

          // first deposit
          await operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            [0],
            tokenAmountsToAdd1,
            addLiquidityData1,
            { gasLimit: 50000000 }
          )

          let liquidity_supply1 = (await operatorExchangeContract.functions.getTotalSupply([0]))[0]
          expect(liquidity_supply1[0]).to.be.eql(BigNumber.from(1000000001))

          let addLiquidityData2 = getAddLiquidityData([BigNumber.from(1000000001)], deadline)
          let tokenAmountsToAdd2 = [BigNumber.from(1)] // 1 less

          // After 2nd deposit
          await operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            [0],
            tokenAmountsToAdd2,
            addLiquidityData2,
            { gasLimit: 50000000 }
          )

          let liquidity_supply2 = (await operatorExchangeContract.functions.getTotalSupply([0]))[0]
          expect(liquidity_supply2[0]).to.be.eql(BigNumber.from(1500000001)) // Should be 1500000001.5
        })

        it('should REVERT if deadline is passed', async () => {
          let timestamp = Math.floor(Date.now() / 1000) - 1
          let addLiquidityData = getAddLiquidityData(currencyAmountsToAdd, timestamp)

          const tx = operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            types,
            tokenAmountsToAdd,
            addLiquidityData,
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.rejectedWith(RevertError('NE20#10'))
        })

        it('should REVERT if a maxCurrency is null', async () => {
          let currencyAmountsToAdd = new Array(nTokenTypes).fill('').map((a, i) => currencyAmountToAdd)
          currencyAmountsToAdd[5] = BigNumber.from(0)
          let addLiquidityData = getAddLiquidityData(currencyAmountsToAdd, deadline)

          const tx = operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            types,
            tokenAmountsToAdd,
            addLiquidityData,
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.rejectedWith(RevertError('NE20#11'))
        })

        it('should REVERT if a token amount is null', async () => {
          let tokenAmountsToAddCopy = [...tokenAmountsToAdd]
          tokenAmountsToAddCopy[5] = BigNumber.from(0)

          const tx = operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            types,
            tokenAmountsToAddCopy,
            addLiquidityData,
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.rejectedWith(RevertError('NE20#12'))
        })

        it('should REVERT if arrays are not the same length', async () => {
          let currencyAmount1 = currencyAmountToAdd.add(1)

          // If expected tier is larger, then should be fine
          let data = getAddLiquidityData([currencyAmountToAdd, currencyAmountToAdd, currencyAmountToAdd], deadline)
          const tx1 = operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            [0, 1],
            [1, 1],
            data,
            TX_PARAM
          )
          await expect(tx1).to.be.fulfilled

          // Everything else should throw
          data = getAddLiquidityData([currencyAmount1, currencyAmount1], deadline)
          const tx2 = operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            [0, 1, 2],
            [1, 1, 1],
            data,
            TX_PARAM
          )
          await expect(tx2).to.be.rejectedWith(OpCodeError())

          data = getAddLiquidityData([currencyAmount1, currencyAmount1], deadline)
          const tx3 = operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            [0, 1],
            [1, 1, 1],
            data,
            TX_PARAM
          )
          await expect(tx3).to.be.rejectedWith(
            RevertError(erc1155_error_prefix + '_safeBatchTransferFrom: INVALID_ARRAYS_LENGTH')
          )

          data = getAddLiquidityData([currencyAmount1], deadline)
          const tx4 = operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            [0, 1],
            [1],
            data,
            TX_PARAM
          )
          await expect(tx4).to.be.rejectedWith(
            RevertError(erc1155_error_prefix + '_safeBatchTransferFrom: INVALID_ARRAYS_LENGTH')
          )

          data = getAddLiquidityData([currencyAmount1, currencyAmount1], deadline)
          const tx5 = operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            [0, 1],
            [1],
            data,
            TX_PARAM
          )
          await expect(tx5).to.be.rejectedWith(
            RevertError(erc1155_error_prefix + '_safeBatchTransferFrom: INVALID_ARRAYS_LENGTH')
          )

          data = getAddLiquidityData([currencyAmount1], deadline)
          const tx6 = operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            [0, 1],
            [1, 1],
            data,
            TX_PARAM
          )
          await expect(tx6).to.be.rejectedWith(OpCodeError())
        })

        it('should REVERT if any duplicate', async () => {
          const tx1 = operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            [1, 1],
            [tokenAmountToAdd, tokenAmountToAdd],
            addLiquidityData,
            { gasLimit: 50000000 }
          )
          await expect(tx1).to.be.rejectedWith(
            RevertError('NE20#32')
          )

          const tx2 = operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            [1, 2, 2],
            [tokenAmountToAdd, tokenAmountToAdd, tokenAmountToAdd],
            addLiquidityData,
            { gasLimit: 50000000 }
          )
          await expect(tx2).to.be.rejectedWith(
            RevertError('NE20#32')
          )

          const tx3 = operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            [1, 2, 1],
            [tokenAmountToAdd, tokenAmountToAdd, tokenAmountToAdd],
            addLiquidityData,
            { gasLimit: 50000000 }
          )
          await expect(tx3).to.be.rejectedWith(
            RevertError('NE20#32')
          )
        })

        context('When liquidity was added', () => {
          const currencyAmountsToAddOne = new Array(nTokenTypes).fill('').map((a, i) => currencyAmountToAdd.add(1))
          const addLiquidityDataOne = getAddLiquidityData(currencyAmountsToAddOne, deadline)

          beforeEach(async () => {
            await operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              types,
              tokenAmountsToAdd,
              addLiquidityData,
              { gasLimit: 50000000 }
            )
          })

          it('should update Token ids balances', async () => {
            for (let i = 0; i < types.length; i++) {
              const exchangeBalance = await userERC1155Contract.functions.balanceOf(niftyswapExchangeContract.address, types[i])
              const operatorBalance = await userERC1155Contract.functions.balanceOf(operatorAddress, types[i])

              expect(exchangeBalance[0]).to.be.eql(tokenAmountToAdd)
              expect(operatorBalance[0]).to.be.eql(BigNumber.from(nTokensPerType).sub(tokenAmountToAdd))
            }
          })

          it('should update currency balances', async () => {
            const exchangeBalance = await userCurrencyContract.functions.balanceOf(niftyswapExchangeContract.address)
            const operatorBalance = await userCurrencyContract.functions.balanceOf(operatorAddress)

            expect(exchangeBalance[0]).to.be.eql(currencyAmountToAdd.mul(nTokenTypes))
            expect(operatorBalance[0]).to.be.eql(BigNumber.from(currencyAmount).sub(currencyAmountToAdd.mul(nTokenTypes)))
          })

          it('should update the currency per token reserve', async () => {
            for (let i = 0; i < types.length; i++) {
              const reserve = await operatorExchangeContract.functions.getCurrencyReserves([types[i]])
              expect(reserve[0][0]).to.be.eql(currencyAmountToAdd)
            }
          })

          it('should update NiftySwap Token ids balances', async () => {
            for (let i = 0; i < types.length; i++) {
              const exchangeBalance = await niftyswapExchangeContract.functions.balanceOf(
                niftyswapExchangeContract.address,
                types[i]
              )
              const operatorBalance = await niftyswapExchangeContract.functions.balanceOf(operatorAddress, types[i])

              expect(exchangeBalance[0]).to.be.eql(ethers.constants.Zero)
              expect(operatorBalance[0]).to.be.eql(BigNumber.from(currencyAmountToAdd))
            }
          })

          it('should update total supplies for Niftyswap Token ids balances', async () => {
            const exchangeTotalSupplies = await niftyswapExchangeContract.functions.getTotalSupply(types)
            for (let i = 0; i < types.length; i++) {
              expect(exchangeTotalSupplies[0][i]).to.be.eql(BigNumber.from(currencyAmountToAdd))
            }
          })

          it('should DECREASE the BUY prices for 2ND deposit', async () => {
            const ones = new Array(nTokenTypes).fill('').map((a, i) => 1)

            // After 1st deposit
            const prePrices = await niftyswapExchangeContract.functions.getPrice_currencyToToken(types, ones)

            // After 2nd deposit
            await operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              types,
              tokenAmountsToAdd,
              addLiquidityDataOne,
              { gasLimit: 50000000 }
            )
            const postPrices = await niftyswapExchangeContract.functions.getPrice_currencyToToken(types, ones)

            for (let i = 0; i < types.length; i++) {
              expect(prePrices[0][i].gte(postPrices[0][i])).to.be.equal(true)
            }
          })

          it('should DECREASE the BUY prices for 3RD deposit', async () => {
            const ones = new Array(nTokenTypes).fill('').map((a, i) => 1)

            // After 2nd deposit
            await operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              types,
              tokenAmountsToAdd,
              addLiquidityDataOne,
              { gasLimit: 50000000 }
            )
            const prePrices = await niftyswapExchangeContract.functions.getPrice_currencyToToken(types, ones)

            // After 3rd deposit
            await operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              types,
              tokenAmountsToAdd,
              addLiquidityDataOne,
              { gasLimit: 50000000 }
            )
            const postPrices = await niftyswapExchangeContract.functions.getPrice_currencyToToken(types, ones)

            for (let i = 0; i < types.length; i++) {
              expect(prePrices[0][i].gte(postPrices[0][i])).to.be.equal(true)
            }
          })

          it('should INCREASE the SELL prices for 2ND deposit', async () => {
            const ones = new Array(nTokenTypes).fill('').map((a, i) => 1)

            // After 1st deposit
            const prePrices = await niftyswapExchangeContract.functions.getPrice_tokenToCurrency(types, ones)

            // After 2nd deposit
            await operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              types,
              tokenAmountsToAdd,
              addLiquidityDataOne,
              { gasLimit: 50000000 }
            )
            const postPrices = await niftyswapExchangeContract.functions.getPrice_tokenToCurrency(types, ones)

            for (let i = 0; i < types.length; i++) {
              expect(prePrices[0][i].lte(postPrices[0][i])).to.be.equal(true)
            }
          })

          it('should INCREASE the SELL prices for 3RD deposit', async () => {
            const ones = new Array(nTokenTypes).fill('').map((a, i) => 1)

            // After 2nd deposit
            await operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              types,
              tokenAmountsToAdd,
              addLiquidityDataOne,
              { gasLimit: 50000000 }
            )
            const prePrices = await niftyswapExchangeContract.functions.getPrice_tokenToCurrency(types, ones)

            // After 3rd deposit
            await operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              types,
              tokenAmountsToAdd,
              addLiquidityDataOne,
              { gasLimit: 50000000 }
            )
            const postPrices = await niftyswapExchangeContract.functions.getPrice_tokenToCurrency(types, ones)

            for (let i = 0; i < types.length; i++) {
              expect(prePrices[0][i].lte(postPrices[0][i])).to.be.equal(true)
            }
          })

          it('should emit LiquidityAdded event', async () => {
            let filterFromOperatorContract: ethers.ethers.EventFilter

            // Get event filter to get internal tx event
            filterFromOperatorContract = niftyswapExchangeContract.filters.LiquidityAdded(null, null, null, null)

            // Get logs from internal transaction event
            // @ts-ignore (https://github.com/ethers-io/ethers.js/issues/204#issuecomment-427059031)
            filterFromOperatorContract.fromBlock = 0
            let logs = await operatorProvider.getLogs(filterFromOperatorContract)
            expect(logs[0].topics[0]).to.be.eql(
              niftyswapExchangeContract.interface.getEventTopic(
                niftyswapExchangeContract.interface.events['LiquidityAdded(address,uint256[],uint256[],uint256[])']
              )
            )
          })

          context('With token metadata', () => {
            it('should revert if prefix metadata contract is not defined', async () => {
              const call = niftyswapExchangeContract.functions.uri(1)
              await expect(call).to.be.rejected
            })

            context('after changing metadata implementation', () => {
              let prefixMetadataContract: ERC1155MetadataPrefix

              beforeEach(async () => {
                prefixMetadataContract = (await erc1155MetadataPrefixAbstract.deploy(ownerWallet, ["", true])) as ERC1155MetadataPrefix
                await niftyswapFactoryContract.setMetadataContract(prefixMetadataContract.address)
              })

              it('should return `id@address` of token', async () => {
                const uri = (await niftyswapExchangeContract.functions.uri(1))[0]
                expect(uri).to.be.eql(`1@${niftyswapExchangeContract.address.toLowerCase()}`)
              })

              it('should return prefixed `id@address` of token', async () => {
                await prefixMetadataContract.functions.setUriPrefix("https://sequence.app/")
                const uri = (await niftyswapExchangeContract.functions.uri(1))[0]
                expect(uri).to.be.eql(`https://sequence.app/1@${niftyswapExchangeContract.address.toLowerCase()}`)
              })

              it('should return uri for 2 ** 256 - 1 id', async () => {
                const maxUint256 = BigNumber.from(2).pow(256).sub(1)
                const uri = (await niftyswapExchangeContract.functions.uri(maxUint256))[0]
                expect(uri).to.be.eql(`${maxUint256.toString()}@${niftyswapExchangeContract.address.toLowerCase()}`)
              })

              it('should change metadata implementation', async () => {
                const prefixMetadataContract2 = (await erc1155MetadataPrefixAbstract.deploy(ownerWallet, ["", false])) as ERC1155MetadataPrefix
                await niftyswapFactoryContract.setMetadataContract(prefixMetadataContract2.address)
                await prefixMetadataContract2.functions.setUriPrefix("https://v2.sequence.app/")
                const uri = (await niftyswapExchangeContract.functions.uri(25666))[0]
                expect(uri).to.be.eql(`https://v2.sequence.app/25666`)
              })
            })
          })
        })

        context('When liquidity was added for the second time', () => {
          const currencyAmountsToAddOne = new Array(nTokenTypes).fill('').map((a, i) => currencyAmountToAdd.add(1))
          const addLiquidityDataOne = getAddLiquidityData(currencyAmountsToAddOne, deadline)

          beforeEach(async () => {
            await operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              types,
              tokenAmountsToAdd,
              addLiquidityData,
              { gasLimit: 50000000 }
            )
            await operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              types,
              tokenAmountsToAdd,
              addLiquidityDataOne,
              { gasLimit: 50000000 }
            )
          })

          it('should REVERT if a maxCurrency is exceeded', async () => {
            let currencyAmountsToAdd = new Array(nTokenTypes).fill('').map((a, i) => currencyAmountToAdd)
            currencyAmountsToAdd[5] = BigNumber.from(1000)
            let addLiquidityData = getAddLiquidityData(currencyAmountsToAdd, deadline)

            const tx = operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              types,
              tokenAmountsToAdd,
              addLiquidityData,
              { gasLimit: 8000000 }
            )
            await expect(tx).to.be.rejectedWith(RevertError('NE20#13'))
          })

          it('should update Token ids balances', async () => {
            for (let i = 0; i < types.length; i++) {
              const exchangeBalance = await userERC1155Contract.functions.balanceOf(niftyswapExchangeContract.address, types[i])
              const operatorBalance = await userERC1155Contract.functions.balanceOf(operatorAddress, types[i])

              expect(exchangeBalance[0]).to.be.eql(tokenAmountToAdd.mul(2))
              expect(operatorBalance[0]).to.be.eql(BigNumber.from(nTokensPerType).sub(tokenAmountToAdd.mul(2)))
            }
          })

          it('should update currency balances', async () => {
            const operatorBalance1 = BigNumber.from(currencyAmount).sub(currencyAmountToAdd.mul(nTokenTypes))

            const exchangeBalance = await userCurrencyContract.functions.balanceOf(niftyswapExchangeContract.address)
            const operatorBalance = await userCurrencyContract.functions.balanceOf(operatorAddress)

            const currencyReserve = currencyAmountToAdd
            const tokenReserve = tokenAmountToAdd
            const currencyAmountCalc = tokenAmountToAdd.mul(currencyReserve).div(tokenReserve)

            // .add(nTokenTypes) is to account for rounding error compensation
            expect(exchangeBalance[0]).to.be.eql(currencyAmountToAdd.mul(nTokenTypes).add(currencyAmountCalc.mul(nTokenTypes)))
            expect(operatorBalance[0]).to.be.eql(operatorBalance1.sub(currencyAmountCalc.mul(nTokenTypes)))
          })

          it('should update the currency amount per token reserve', async () => {
            for (let i = 0; i < types.length; i++) {
              const reserve = await niftyswapExchangeContract.functions.getCurrencyReserves([types[i]])
              const newCurrencyAmount = tokenAmountToAdd.mul(currencyAmountToAdd).div(tokenAmountToAdd)

              // .add(1) is to account for rounding error protection
              expect(reserve[0][0]).to.be.eql(currencyAmountToAdd.add(newCurrencyAmount))
            }
          })

          it('should update NiftySwap Token ids balances', async () => {
            for (let i = 0; i < types.length; i++) {
              const exchangeBalance = await niftyswapExchangeContract.functions.balanceOf(
                niftyswapExchangeContract.address,
                types[i]
              )
              const operatorBalance = await niftyswapExchangeContract.functions.balanceOf(operatorAddress, types[i])

              const newCurrencyAmount = tokenAmountToAdd.mul(currencyAmountToAdd).div(tokenAmountToAdd)

              // .add(1) is to account for rounding error protection
              expect(operatorBalance[0]).to.be.eql(BigNumber.from(currencyAmountToAdd).add(newCurrencyAmount))
              expect(exchangeBalance[0]).to.be.eql(ethers.constants.Zero)
            }
          })

          it('should update total supples for Niftyswap Token ids balances', async () => {
            for (let i = 0; i < types.length; i++) {
              const exchangeTotalSupply = await niftyswapExchangeContract.functions.getTotalSupply([types[i]])
              const newCurrencyAmount = tokenAmountToAdd.mul(currencyAmountToAdd).div(tokenAmountToAdd)

              // .add(1) is to account for rounding error protection
              expect(exchangeTotalSupply[0][0]).to.be.eql(BigNumber.from(currencyAmountToAdd).add(newCurrencyAmount))
            }
          })
        })

        describe('When liquidity > 0', () => {
          beforeEach(async () => {
            await operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              types,
              tokenAmountsToAdd,
              addLiquidityData,
              { gasLimit: 8000000 }
            )
          })

          it('should pass when balances are sufficient', async () => {
            let maxCurrency: BigNumber[] = []

            for (let i = 0; i < nTokenTypes; i++) {
              maxCurrency.push(currencyAmountToAdd.mul(2))
            }
            let addLiquidityData2 = getAddLiquidityData(maxCurrency, deadline)

            const tx = operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              types,
              tokenAmountsToAdd,
              addLiquidityData2,
              { gasLimit: 8000000 }
            )
            await expect(tx).to.be.fulfilled
          })
        })
      })

      describe('_removeLiquidity() function', () => {
        const nTokenTypesToRemove = 30

        const tokenAmountToRemove = BigNumber.from(75)
        const currencyAmountToRemove = BigNumber.from(10)
          .pow(18)
          .mul(299)
          .div(4)

        const typesToRemove = new Array(nTokenTypesToRemove).fill('').map((a, i) => getBig(i))

        const tokenAmountsToRemove = new Array(nTokenTypesToRemove).fill('').map((a, i) => tokenAmountToRemove)
        const currencyAmountsToRemove = new Array(nTokenTypesToRemove).fill('').map((a, i) => currencyAmountToRemove)

        const niftyTokenToSend = new Array(nTokenTypesToRemove).fill('').map((a, i) => currencyAmountToRemove)

        const removeLiquidityData: string = getRemoveLiquidityData(currencyAmountsToRemove, tokenAmountsToRemove, deadline)

        it('should revert if no Niftyswap token', async () => {
          const tx = operatorExchangeContract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            typesToRemove,
            niftyTokenToSend,
            removeLiquidityData,
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.rejectedWith(RevertError('SafeMath#sub: UNDERFLOW'))
        })

        it('should revert if empty reserve', async () => {
          const zeroArray = new Array(nTokenTypesToRemove).fill('').map((a, i) => BigNumber.from(0))
          const tx = operatorExchangeContract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            typesToRemove,
            zeroArray,
            removeLiquidityData,
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.rejectedWith(RevertError('NE20#16'))
        })

        describe('Trade token rounding error', () => {
          it('Should trade rounding error when withdrawing liquidity', async () => {
            const types = [BigNumber.from(1)]
            const currencyAmountToAdd = [BigNumber.from(25000)]
            const tokenAmountToAdd = [BigNumber.from(100)]
  
            await operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              types,
              tokenAmountToAdd,
              getAddLiquidityData(currencyAmountToAdd, deadline),
              { gasLimit: 50000000 }
            )

            // Add a single unit of liquidity
            await operatorERC1155Contract.connect(userWallet).functions.safeBatchTransferFrom(
              userAddress,
              niftyswapExchangeContract.address,
              types,
              [1],
              getAddLiquidityData([BigNumber.from(250)], deadline),
              { gasLimit: 50000000 }
            )

            let userTokenBalance = await userERC1155Contract.functions.balanceOf(userAddress, types[0])
            let userCurrencyBalance = await userCurrencyContract.functions.balanceOf(userAddress)

            const maxCurrency = extraFeeArray.length === 0 ? BigNumber.from(300) : BigNumber.from(300).add(extraFeeArray[0])

            // Buy a single unit of token, force amount to be rounded
            await userExchangeContract.functions.buyTokens(
              types,
              [BigNumber.from(1)],
              maxCurrency,
              deadline,
              userAddress,
              [],
              [],
              { gasLimit: 8000000 }
            )

            userTokenBalance = await userERC1155Contract.functions.balanceOf(userAddress, types[0])
            userCurrencyBalance = await userCurrencyContract.functions.balanceOf(userAddress)

            // Withdraw liquidity, it should return 0 tokens but more than 250 currency
            await niftyswapExchangeContract.connect(userWallet).functions.safeBatchTransferFrom(
              userAddress,
              niftyswapExchangeContract.address,
              types,
              [250],
              getRemoveLiquidityData([BigNumber.from(250)], [BigNumber.from(0)], deadline),
              { gasLimit: 8000000 }
            )

            const newUserCurrencyBalance = await userCurrencyContract.functions.balanceOf(userAddress)
            const newUserTokenBalance = await userERC1155Contract.functions.balanceOf(userAddress, types[0])

            const diffUserCurrency = newUserCurrencyBalance[0].sub(userCurrencyBalance[0])
            const diffUserToken = newUserTokenBalance[0].sub(userTokenBalance[0])

            // User should always withdraw 0 tokens
            expect(diffUserToken).to.be.eql(BigNumber.from(0))

            // If fee is 2% user should withdraw 492 currency, if not 497
            if (royaltyFee.isZero()) {
              expect(diffUserCurrency).to.be.eql(BigNumber.from(497))
            } else {
              if (LP_FEE === 100) {
                expect(diffUserCurrency).to.be.eql(BigNumber.from(471))
              } else {
                expect(diffUserCurrency).to.be.eql(BigNumber.from(492))
              }
            }
          })

          it('Should trade rounding error with high slippage when withdrawing liquidity', async () => {
            const types = [BigNumber.from(1)]
            const currencyAmountToAdd = [BigNumber.from(1250)]
            const tokenAmountToAdd = [BigNumber.from(5)]
  
            await operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              types,
              tokenAmountToAdd,
              getAddLiquidityData(currencyAmountToAdd, deadline),
              { gasLimit: 50000000 }
            )

            // Add a single unit of liquidity
            await operatorERC1155Contract.connect(userWallet).functions.safeBatchTransferFrom(
              userAddress,
              niftyswapExchangeContract.address,
              types,
              [1],
              getAddLiquidityData([BigNumber.from(250)], deadline),
              { gasLimit: 50000000 }
            )

            let userTokenBalance = await userERC1155Contract.functions.balanceOf(userAddress, types[0])
            let userCurrencyBalance = await userCurrencyContract.functions.balanceOf(userAddress)

            const maxCurrency = extraFeeArray.length === 0 ? BigNumber.from(1000) : BigNumber.from(1000).add(extraFeeArray[0])

            // Buy a single unit of token, force amount to be rounded
            await userExchangeContract.functions.buyTokens(
              types,
              [BigNumber.from(1)],
              maxCurrency,
              deadline,
              userAddress,
              [],
              [],
              { gasLimit: 8000000 }
            )

            userTokenBalance = await userERC1155Contract.functions.balanceOf(userAddress, types[0])
            userCurrencyBalance = await userCurrencyContract.functions.balanceOf(userAddress)

            // // Withdraw liquidity, it should return 0 tokens but more than 250 currency
            await niftyswapExchangeContract.connect(userWallet).functions.safeBatchTransferFrom(
              userAddress,
              niftyswapExchangeContract.address,
              types,
              [250],
              getRemoveLiquidityData([BigNumber.from(250)], [BigNumber.from(0)], deadline),
              { gasLimit: 8000000 }
            )

            const newUserCurrencyBalance = await userCurrencyContract.functions.balanceOf(userAddress)
            const newUserTokenBalance = await userERC1155Contract.functions.balanceOf(userAddress, types[0])

            const diffUserCurrency = newUserCurrencyBalance[0].sub(userCurrencyBalance[0])
            const diffUserToken = newUserTokenBalance[0].sub(userTokenBalance[0])

            // User should always withdraw 0 tokens
            expect(diffUserToken).to.be.eql(BigNumber.from(0))

            // If fee is 2% user should withdraw 509 currency, if not 513
            if (royaltyFee.isZero()) {
              expect(diffUserCurrency).to.be.eql(BigNumber.from(513))
            } else {
              if (LP_FEE === 100) {
                expect(diffUserCurrency).to.be.eql(BigNumber.from(501))
              } else {
                expect(diffUserCurrency).to.be.eql(BigNumber.from(509))
              }
            }
          })

          it('Should trade rounding error when withdrawing liquidity, without rounding to zero', async () => {
            const types = [BigNumber.from(1)]
            const currencyAmountToAdd = [BigNumber.from(25000)]
            const tokenAmountToAdd = [BigNumber.from(100)]
  
            await operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              types,
              tokenAmountToAdd,
              getAddLiquidityData(currencyAmountToAdd, deadline),
              { gasLimit: 50000000 }
            )

            // Add a single unit of liquidity
            await operatorERC1155Contract.connect(userWallet).functions.safeBatchTransferFrom(
              userAddress,
              niftyswapExchangeContract.address,
              types,
              [2],
              getAddLiquidityData([BigNumber.from(500)], deadline),
              { gasLimit: 50000000 }
            )

            let userTokenBalance = await userERC1155Contract.functions.balanceOf(userAddress, types[0])
            let userCurrencyBalance = await userCurrencyContract.functions.balanceOf(userAddress)

            const maxCurrency = extraFeeArray.length === 0 ? BigNumber.from(300) : BigNumber.from(300).add(extraFeeArray[0])

            // Buy a single unit of token, force amount to be rounded
            await userExchangeContract.functions.buyTokens(
              types,
              [BigNumber.from(1)],
              maxCurrency,
              deadline,
              userAddress,
              [],
              [],
              { gasLimit: 8000000 }
            )

            // Get liquidity of tokens, currency and totalSupply
            userTokenBalance = await userERC1155Contract.functions.balanceOf(userAddress, types[0])
            userCurrencyBalance = await userCurrencyContract.functions.balanceOf(userAddress)

            // Withdraw liquidity, it should return 0 tokens but more than 250 currency
            await niftyswapExchangeContract.connect(userWallet).functions.safeBatchTransferFrom(
              userAddress,
              niftyswapExchangeContract.address,
              types,
              [500],
              getRemoveLiquidityData([BigNumber.from(250)], [BigNumber.from(0)], deadline),
              { gasLimit: 8000000 }
            )

            const newUserCurrencyBalance = await userCurrencyContract.functions.balanceOf(userAddress)
            const newUserTokenBalance = await userERC1155Contract.functions.balanceOf(userAddress, types[0])

            const diffUserCurrency = newUserCurrencyBalance[0].sub(userCurrencyBalance[0])
            const diffUserToken = newUserTokenBalance[0].sub(userTokenBalance[0])

            expect(diffUserToken).to.be.eql(BigNumber.from(1))

            if (royaltyFee.isZero()) {
              expect(diffUserCurrency).to.be.eql(BigNumber.from(747))
            } else {
              if (LP_FEE === 100) {
                expect(diffUserCurrency).to.be.eql(BigNumber.from(722))
              } else {
                expect(diffUserCurrency).to.be.eql(BigNumber.from(742))
              }
            }
          })
        })

        context('When liquidity was added', () => {
          beforeEach(async () => {
            await operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              typesToRemove,
              tokenAmountsToAdd,
              addLiquidityData,
              { gasLimit: 50000000 }
            )
          })

          it('should revert if insufficient currency', async () => {
            let currencyAmountsToRemoveCopy = [...currencyAmountsToRemove]
            currencyAmountsToRemoveCopy[5] = BigNumber.from(currencyAmountsToRemoveCopy[5].mul(10000))
            let removeLiquidityData = getRemoveLiquidityData(currencyAmountsToRemoveCopy, tokenAmountsToRemove, deadline)

            const tx = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              typesToRemove,
              niftyTokenToSend,
              removeLiquidityData,
              { gasLimit: 8000000 }
            )
            await expect(tx).to.be.rejectedWith(RevertError('NE20#17'))
          })

          it('should revert if insufficient tokens', async () => {
            let tokenAmountsToRemoveCopy = [...tokenAmountsToRemove]
            tokenAmountsToRemoveCopy[5] = BigNumber.from(tokenAmountsToRemoveCopy[5].mul(10000))
            let removeLiquidityData = getRemoveLiquidityData(currencyAmountsToRemove, tokenAmountsToRemoveCopy, deadline)

            const tx = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              typesToRemove,
              niftyTokenToSend,
              removeLiquidityData,
              { gasLimit: 8000000 }
            )
            await expect(tx).to.be.rejectedWith(RevertError('NE20#18'))
          })

          it('should fail if any duplicate', async () => {
            const tx1 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [1, 1],
              [currencyAmountToRemove, currencyAmountToRemove],
              removeLiquidityData,
              { gasLimit: 8000000 }
            )
            await expect(tx1).to.be.rejectedWith(
              RevertError('NE20#32')
            )

            const tx2 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [1, 2, 2],
              [currencyAmountToRemove, currencyAmountToRemove, currencyAmountToRemove],
              removeLiquidityData,
              { gasLimit: 8000000 }
            )
            await expect(tx2).to.be.rejectedWith(
              RevertError('NE20#32')
            )

            const tx3 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [1, 2, 1],
              [currencyAmountToRemove, currencyAmountToRemove, currencyAmountToRemove],
              removeLiquidityData,
              { gasLimit: 8000000 }
            )
            await expect(tx3).to.be.rejectedWith(
              RevertError('NE20#32')
            )
          })

          it('should REVERT if arrays are not the same length', async () => {
            // If expected tier is larger, then should be fine
            let data = getRemoveLiquidityData([currencyAmountToRemove], [tokenAmountToRemove], deadline)
            const tx1 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [0, 1],
              [currencyAmountToRemove],
              data,
              TX_PARAM
            )
            await expect(tx1).to.be.rejectedWith(RevertError('ERC1155#_safeBatchTransferFrom: INVALID_ARRAYS_LENGTH'))

            // Everything else should throw
            data = getRemoveLiquidityData([currencyAmountToRemove], [tokenAmountToRemove], deadline)
            const tx2 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [2],
              [currencyAmountToRemove, currencyAmountToRemove],
              data,
              TX_PARAM
            )
            await expect(tx2).to.be.rejectedWith(RevertError('ERC1155#_safeBatchTransferFrom: INVALID_ARRAYS_LENGTH'))

            data = getRemoveLiquidityData([currencyAmountToRemove, currencyAmountToRemove], [tokenAmountToRemove], deadline)
            const tx3 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [3],
              [currencyAmountToRemove],
              data,
              TX_PARAM
            )
            await expect(tx3).to.be.fulfilled

            data = getRemoveLiquidityData([currencyAmountToRemove], [tokenAmountToRemove, tokenAmountToRemove], deadline)
            const tx4 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [4],
              [currencyAmountToRemove],
              data,
              TX_PARAM
            )
            await expect(tx4).to.be.fulfilled

            data = getRemoveLiquidityData([currencyAmountToRemove], [tokenAmountToRemove], deadline)
            const tx5 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [5, 6],
              [currencyAmountToRemove, currencyAmountToRemove],
              data,
              TX_PARAM
            )
            await expect(tx5).to.be.rejectedWith(OpCodeError())

            data = getRemoveLiquidityData([currencyAmountToRemove, currencyAmountToRemove], [tokenAmountToRemove], deadline)
            const tx6 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [7, 8],
              [currencyAmountToRemove],
              data,
              TX_PARAM
            )
            await expect(tx6).to.be.rejectedWith(RevertError('ERC1155#_safeBatchTransferFrom: INVALID_ARRAYS_LENGTH'))

            data = getRemoveLiquidityData([currencyAmountToRemove], [tokenAmountToRemove, currencyAmountToRemove], deadline)
            const tx7 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [9, 10],
              [currencyAmountToRemove],
              data,
              TX_PARAM
            )
            await expect(tx7).to.be.rejectedWith(RevertError('ERC1155#_safeBatchTransferFrom: INVALID_ARRAYS_LENGTH'))

            data = getRemoveLiquidityData([currencyAmountToRemove, currencyAmountToRemove], [tokenAmountToRemove], deadline)
            const tx8 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [11],
              [currencyAmountToRemove, currencyAmountToRemove],
              data,
              TX_PARAM
            )
            await expect(tx8).to.be.rejectedWith(RevertError('ERC1155#_safeBatchTransferFrom: INVALID_ARRAYS_LENGTH'))

            data = getRemoveLiquidityData([currencyAmountToRemove], [tokenAmountToRemove, tokenAmountToRemove], deadline)
            const tx9 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [12],
              [currencyAmountToRemove, currencyAmountToRemove],
              data,
              TX_PARAM
            )
            await expect(tx9).to.be.rejectedWith(RevertError('ERC1155#_safeBatchTransferFrom: INVALID_ARRAYS_LENGTH'))

            data = getRemoveLiquidityData(
              [currencyAmountToRemove, currencyAmountToRemove],
              [tokenAmountToRemove, tokenAmountToRemove],
              deadline
            )
            const tx10 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [13],
              [currencyAmountToRemove],
              data,
              TX_PARAM
            )
            await expect(tx10).to.be.fulfilled

            data = getRemoveLiquidityData([currencyAmountToRemove, currencyAmountToRemove], [tokenAmountToRemove], deadline)
            const tx11 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [14, 15],
              [currencyAmountToRemove, currencyAmountToRemove],
              data,
              TX_PARAM
            )
            await expect(tx11).to.be.rejectedWith(OpCodeError())

            data = getRemoveLiquidityData([currencyAmountToRemove], [tokenAmountToRemove, tokenAmountToRemove], deadline)
            const tx12 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [16, 17],
              [currencyAmountToRemove, currencyAmountToRemove],
              data,
              TX_PARAM
            )
            await expect(tx12).to.be.rejectedWith(OpCodeError())

            data = getRemoveLiquidityData(
              [currencyAmountToRemove, currencyAmountToRemove],
              [tokenAmountToRemove, tokenAmountToRemove],
              deadline
            )
            const tx13 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [18, 19],
              [currencyAmountToRemove],
              data,
              TX_PARAM
            )
            await expect(tx13).to.be.rejectedWith(RevertError('ERC1155#_safeBatchTransferFrom: INVALID_ARRAYS_LENGTH'))

            data = getRemoveLiquidityData(
              [currencyAmountToRemove, currencyAmountToRemove],
              [tokenAmountToRemove, tokenAmountToRemove],
              deadline
            )
            const tx14 = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              [20],
              [currencyAmountToRemove, currencyAmountToRemove],
              data,
              TX_PARAM
            )
            await expect(tx14).to.be.rejectedWith(RevertError('ERC1155#_safeBatchTransferFrom: INVALID_ARRAYS_LENGTH'))
          })

          it('should PASS if enough Niftyswap token', async () => {
            const tx = operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              typesToRemove,
              niftyTokenToSend,
              removeLiquidityData,
              { gasLimit: 8000000 }
            )
            await expect(tx).to.be.fulfilled
          })

          it('should INCREASE the BUY prices for 2ND withdraw', async () => {
            const ones = new Array(nTokenTypesToRemove).fill('').map((a, i) => 1)

            // After 1st deposit
            const prePrices = await niftyswapExchangeContract.functions.getPrice_currencyToToken(types, ones)

            // After 2nd deposit
            await operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              typesToRemove,
              niftyTokenToSend,
              removeLiquidityData,
              { gasLimit: 8000000 }
            )
            const postPrices = await niftyswapExchangeContract.functions.getPrice_currencyToToken(types, ones)

            for (let i = 0; i < types.length; i++) {
              expect(prePrices[0][i].lte(postPrices[0][i])).to.be.equal(true)
            }
          })

          it('should INCREASE the BUY prices for 3RD withdraw', async () => {
            const ones = new Array(nTokenTypesToRemove).fill('').map((a, i) => 1)

            // After 2nd deposit
            await operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              typesToRemove,
              niftyTokenToSend,
              removeLiquidityData,
              { gasLimit: 8000000 }
            )
            const prePrices = await niftyswapExchangeContract.functions.getPrice_currencyToToken(types, ones)

            // After 3rd deposit
            await operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              typesToRemove,
              niftyTokenToSend,
              removeLiquidityData,
              { gasLimit: 8000000 }
            )
            const postPrices = await niftyswapExchangeContract.functions.getPrice_currencyToToken(types, ones)

            for (let i = 0; i < types.length; i++) {
              expect(prePrices[0][i].lte(postPrices[0][i])).to.be.equal(true)
            }
          })

          it('should DECREASE the SELL prices for 2ND withdraw', async () => {
            const ones = new Array(nTokenTypesToRemove).fill('').map((a, i) => 1)

            // After 1st deposit
            const prePrices = await niftyswapExchangeContract.functions.getPrice_tokenToCurrency(types, ones)

            // After 2nd deposit
            await operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              typesToRemove,
              niftyTokenToSend,
              removeLiquidityData,
              { gasLimit: 8000000 }
            )
            const postPrices = await niftyswapExchangeContract.functions.getPrice_tokenToCurrency(types, ones)

            for (let i = 0; i < types.length; i++) {
              expect(prePrices[0][i].gte(postPrices[0][i])).to.be.equal(true)
            }
          })

          it('should DECREASE the SELL prices for 3RD withdraw', async () => {
            const ones = new Array(nTokenTypesToRemove).fill('').map((a, i) => 1)

            // After 2nd deposit
            await operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              typesToRemove,
              niftyTokenToSend,
              removeLiquidityData,
              { gasLimit: 8000000 }
            )
            const prePrices = await niftyswapExchangeContract.functions.getPrice_tokenToCurrency(types, ones)

            // After 3rd deposit
            await operatorExchangeContract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              typesToRemove,
              niftyTokenToSend,
              removeLiquidityData,
              { gasLimit: 8000000 }
            )
            const postPrices = await niftyswapExchangeContract.functions.getPrice_tokenToCurrency(types, ones)

            for (let i = 0; i < types.length; i++) {
              expect(prePrices[0][i].gte(postPrices[0][i])).to.be.equal(true)
            }
          })

          context('When liquidity was removed', () => {
            let tx
            beforeEach(async () => {
              tx = await operatorExchangeContract.functions.safeBatchTransferFrom(
                operatorAddress,
                niftyswapExchangeContract.address,
                typesToRemove,
                niftyTokenToSend,
                removeLiquidityData,
                { gasLimit: 8000000 }
              )
            })

            it('should update Token ids balances', async () => {
              const expectedVal = tokenAmountToAdd.sub(tokenAmountToRemove)
              for (let i = 0; i < types.length; i++) {
                const exchangeBalance = await userERC1155Contract.functions.balanceOf(niftyswapExchangeContract.address, types[i])
                const operatorBalance = await userERC1155Contract.functions.balanceOf(operatorAddress, types[i])

                expect(exchangeBalance[0]).to.be.eql(BigNumber.from(expectedVal))
                expect(operatorBalance[0]).to.be.eql(BigNumber.from(nTokensPerType).sub(expectedVal))
              }
            })

            it('should update currency balances', async () => {
              const expectedVal = currencyAmountToAdd.mul(nTokenTypes).sub(currencyAmountToRemove.mul(nTokenTypes))
              const exchangeBalance = await userCurrencyContract.functions.balanceOf(
                niftyswapExchangeContract.address,
              )
              const operatorBalance = await userCurrencyContract.functions.balanceOf(operatorAddress)

              expect(exchangeBalance[0]).to.be.eql(expectedVal)
              expect(operatorBalance[0]).to.be.eql(currencyAmount.sub(expectedVal))
            })

            it('should update the currency amount per token reserve', async () => {
              const expectedVal = currencyAmountToAdd.sub(currencyAmountToRemove)
              const reserves = await niftyswapExchangeContract.functions.getCurrencyReserves(types)
              for (let i = 0; i < types.length; i++) {
                expect(reserves[0][i]).to.be.eql(expectedVal)
              }
            })

            it('should update NiftySwap Token ids balances', async () => {
              const expectedVal = currencyAmountToAdd.sub(currencyAmountToRemove)
              for (let i = 0; i < types.length; i++) {
                const exchangeBalance = await niftyswapExchangeContract.functions.balanceOf(
                  niftyswapExchangeContract.address,
                  types[i]
                )
                const operatorBalance = await niftyswapExchangeContract.functions.balanceOf(operatorAddress, types[i])

                expect(exchangeBalance[0]).to.be.eql(ethers.constants.Zero)
                expect(operatorBalance[0]).to.be.eql(expectedVal)
              }
            })

            it('should update total supplies for Niftyswap Token ids balances', async () => {
              const expectedVal = currencyAmountToAdd.sub(currencyAmountToRemove)
              const exchangeTotalSupplies = await niftyswapExchangeContract.functions.getTotalSupply(types)
              for (let i = 0; i < types.length; i++) {
                expect(exchangeTotalSupplies[0][i]).to.be.eql(expectedVal)
              }
            })

            it('should emit LiquidityRemoved event', async () => {
              const receipt = await tx.wait(1)
              const ev = receipt.events!.pop()!
              expect(ev.event).to.be.eql('LiquidityRemoved')
            })
          })
        })
      })

      describe('_tokenToCurrency() function', () => {
        //Sell
        const tokenAmountToSell = BigNumber.from(50)
        const tokensAmountsToSell: BigNumber[] = new Array(nTokenTypes).fill('').map((a, i) => tokenAmountToSell)
        let sellTokenData: string
        let cost: BigNumber
        let expectedRoyalty: BigNumber
        let preRoyaltyCost: BigNumber

        beforeEach(async () => {
          // Add liquidity
          await operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            types,
            tokenAmountsToAdd,
            addLiquidityData,
            { gasLimit: 30000000 }
          )

          const allcosts = (await niftyswapExchangeContract.functions.getPrice_tokenToCurrency(types, tokensAmountsToSell))
          cost = allcosts[0].reduce((acc: BigNumber, a: BigNumber) => acc.add(a)).sub(extraFee)

          // Expected royalty 
          const tokenReserve = (await ownerERC1155Contract.balanceOf(niftyswapExchangeContract.address, 0))
          const currencyReserve = (await niftyswapExchangeContract.functions.getCurrencyReserves([0]))[0][0]
          preRoyaltyCost = (await niftyswapExchangeContract.functions.getSellPrice(tokenAmountToSell, tokenReserve, currencyReserve))[0]
          expectedRoyalty = (preRoyaltyCost.mul(royaltyFee)).div(10000).mul(nTokenTypes)

          // Sell
          sellTokenData = getSellTokenData20(userAddress, cost, deadline, extraFeeRecipients, extraFeeArray)
        })

        it('should fail if token balance is insufficient', async () => {
          await userERC1155Contract.functions.safeTransferFrom(userAddress, ownerAddress, types[0], nTokensPerType, [])
          const tx = userERC1155Contract.functions.safeBatchTransferFrom(
            userAddress,
            niftyswapExchangeContract.address,
            types,
            tokensAmountsToSell,
            sellTokenData,
            { gasLimit: 8000000 }
          )
          if (condition[1] != 2) {
            await expect(tx).to.be.rejectedWith(RevertError('SafeMath#sub: UNDERFLOW'))
          } else {
            await expect(tx).to.be.rejectedWith(RevertError(erc1155_error_prefix + '_viewUpdateBinValue: UNDERFLOW'))
          }
        })

        it('should fail if token sent is 0', async () => {
          let tokensAmountsToSellCopy = [...tokensAmountsToSell]
          tokensAmountsToSellCopy[0] = BigNumber.from(0)

          const tx = userERC1155Contract.functions.safeBatchTransferFrom(
            userAddress,
            niftyswapExchangeContract.address,
            types,
            tokensAmountsToSellCopy,
            sellTokenData,
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.rejectedWith(RevertError('NE20#7'))
        })

        it('should fail if deadline is passed', async () => {
          let timestamp = Math.floor(Date.now() / 1000) - 1
          const price = (await niftyswapExchangeContract.functions.getPrice_tokenToCurrency([0], [tokenAmountToSell]))[0]
          let sellTokenData = getSellTokenData20(userAddress, price[0].mul(nTokenTypes), timestamp, extraFeeRecipients, extraFeeArray)

          const tx = userERC1155Contract.functions.safeBatchTransferFrom(
            userAddress,
            niftyswapExchangeContract.address,
            types,
            tokensAmountsToSell,
            sellTokenData,
            { gasLimit: 8000000 }
          )

          await expect(tx).to.be.rejectedWith(RevertError('NE20#6'))
        })

        it('should pass if currency balance is equal to cost', async () => {
          let sellTokenData = getSellTokenData20(userAddress, cost, deadline, extraFeeRecipients, extraFeeArray)

          const tx = userERC1155Contract.functions.safeBatchTransferFrom(
            userAddress,
            niftyswapExchangeContract.address,
            types,
            tokensAmountsToSell,
            sellTokenData,
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.fulfilled
        })

        it('should fail if currency balance is lower than cost', async () => {
          let sellTokenData = getSellTokenData20(userAddress, cost.add(1), deadline, extraFeeRecipients, extraFeeArray)

          const tx = userERC1155Contract.functions.safeBatchTransferFrom(
            userAddress,
            niftyswapExchangeContract.address,
            types,
            tokensAmountsToSell,
            sellTokenData,
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.rejectedWith(RevertError('NE20#8'))
        })

        it('should fail if any duplicate', async () => {
          const tx1 = userERC1155Contract.functions.safeBatchTransferFrom(
            userAddress,
            niftyswapExchangeContract.address,
            [1, 1],
            [tokenAmountToSell, tokenAmountToSell],
            sellTokenData,
            { gasLimit: 8000000 }
          )
          await expect(tx1).to.be.rejectedWith(
            RevertError('NE20#32')
          )

          const tx2 = userERC1155Contract.functions.safeBatchTransferFrom(
            userAddress,
            niftyswapExchangeContract.address,
            [1, 2, 2],
            [tokenAmountToSell, tokenAmountToSell, tokenAmountToSell],
            sellTokenData,
            { gasLimit: 8000000 }
          )
          await expect(tx2).to.be.rejectedWith(
            RevertError('NE20#32')
          )

          const tx3 = userERC1155Contract.functions.safeBatchTransferFrom(
            userAddress,
            niftyswapExchangeContract.address,
            [1, 2, 1],
            [tokenAmountToSell, tokenAmountToSell, tokenAmountToSell],
            sellTokenData,
            { gasLimit: 8000000 }
          )
          await expect(tx3).to.be.rejectedWith(
            RevertError('NE20#32')
          )
        })

        it('should REVERT if arrays are not the same length', async () => {
          const tx1 = userERC1155Contract.functions.safeBatchTransferFrom(
            userAddress,
            niftyswapExchangeContract.address,
            [0, 1],
            [tokenAmountToSell],
            sellTokenData,
            TX_PARAM
          )
          await expect(tx1).to.be.rejectedWith(
            RevertError(erc1155_error_prefix + '_safeBatchTransferFrom: INVALID_ARRAYS_LENGTH')
          )

          const tx2 = userERC1155Contract.functions.safeBatchTransferFrom(
            userAddress,
            niftyswapExchangeContract.address,
            [0],
            [tokenAmountToSell, tokenAmountToSell],
            sellTokenData,
            TX_PARAM
          )
          await expect(tx2).to.be.rejectedWith(
            RevertError(erc1155_error_prefix + '_safeBatchTransferFrom: INVALID_ARRAYS_LENGTH')
          )
        })

        it('should sell tokens when balances are sufficient', async () => {
          const tx = userERC1155Contract.functions.safeBatchTransferFrom(
            userAddress,
            niftyswapExchangeContract.address,
            types,
            tokensAmountsToSell,
            sellTokenData,
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.fulfilled
        })

        it('should REVERT if not accounting for the extra fee', async () => {
          sellTokenData = getSellTokenData20(userAddress, cost.add(extraFee), deadline, [extraFeeRecipient], [BigNumber.from(1)])
          const tx = userERC1155Contract.functions.safeBatchTransferFrom(
            userAddress,
            niftyswapExchangeContract.address,
            types,
            tokensAmountsToSell,
            sellTokenData,
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.rejectedWith(RevertError("NE20#8"))
        })

        describe('When trade is successful', async () => {
          let tx
          beforeEach(async () => {
            tx = await userERC1155Contract.functions.safeBatchTransferFrom(
              userAddress,
              niftyswapExchangeContract.address,
              types,
              tokensAmountsToSell,
              sellTokenData,
              { gasLimit: 8000000 }
            )
          })

          it('should update Tokens balances if it passes', async () => {
            for (let i = 0; i < types.length; i++) {
              const exchangeBalance = await userERC1155Contract.functions.balanceOf(niftyswapExchangeContract.address, types[i])
              const userBalance = await userERC1155Contract.functions.balanceOf(userAddress, types[i])

              expect(exchangeBalance[0]).to.be.eql(tokenAmountToAdd.add(tokenAmountToSell))
              expect(userBalance[0]).to.be.eql(BigNumber.from(nTokensPerType).sub(tokenAmountToSell))
            }
          })

          it('should update currency balances if it passes', async () => {
            const exchangeBalance = await userCurrencyContract.functions.balanceOf(niftyswapExchangeContract.address)
            const userBalance = await userCurrencyContract.functions.balanceOf(userAddress)

            expect(exchangeBalance[0]).to.be.eql(currencyAmountToAdd.mul(nTokenTypes).sub(cost))
            expect(userBalance[0]).to.be.eql(currencyAmount.add(cost))
          })

          it('should update the currency amounts per token reserve', async () => {
            const reserves = await niftyswapExchangeContract.functions.getCurrencyReserves(types)
            for (let i = 0; i < types.length; i++) {
              // Extra fee and royalty aren't going to the reserve
              expect(reserves[0][i]).to.be.eql(currencyAmountToAdd.sub((cost.add(extraFee).add(expectedRoyalty)).div(nTokenTypes)))
            }
          })

          it('should have token sell price adjusted', async () => {
            const newCost: BigNumber = (await niftyswapExchangeContract.functions.getPrice_tokenToCurrency([0], [tokenAmountToSell]))[0][0]
        
            const soldAmountWithFee = tokenAmountToSell.mul(LP_FEE_MULTIPLIER)
            const currencyReserve = currencyAmountToAdd.sub((cost.add(extraFee).add(expectedRoyalty)).div(nTokenTypes))
            let numerator = soldAmountWithFee.mul(currencyReserve)
            let tokenReserveWithFee = tokenAmountToAdd.add(tokenAmountToSell).mul(1000)
            let denominator = tokenReserveWithFee.add(soldAmountWithFee)
            const newPreRoyaltyCost = numerator.div(denominator)
            const newRoyalty = (newPreRoyaltyCost.mul(royaltyFee)).div(10000)

            expect(newCost).to.be.eql(newPreRoyaltyCost.sub(newRoyalty))
          })

          it('should emit CurrencyPurchase event', async () => {
            let filterFromOperatorContract: ethers.ethers.EventFilter

            // Get event filter to get internal tx event
            filterFromOperatorContract = niftyswapExchangeContract.filters.CurrencyPurchase(null, null, null, null, null, null, null)

            // Get logs from internal transaction event
            // @ts-ignore (https://github.com/ethers-io/ethers.js/issues/204#issuecomment-427059031)
            filterFromOperatorContract.fromBlock = 0
            let logs = await operatorProvider.getLogs(filterFromOperatorContract)
            expect(logs[0].topics[0]).to.be.eql(
              niftyswapExchangeContract.interface.getEventTopic(
                niftyswapExchangeContract.interface.events['CurrencyPurchase(address,address,uint256[],uint256[],uint256[],address[],uint256[])']
              )
            )
          })

          describe('CurrencyPurchase Event', () => {
            let args;

            beforeEach(async () => {
              const eventTopicHash = niftyswapExchangeContract.interface.getEventTopic(
                niftyswapExchangeContract.interface.events['CurrencyPurchase(address,address,uint256[],uint256[],uint256[],address[],uint256[])']
              )
              const receipt = await tx.wait(1)
              const log = receipt.logs.find(a => a['topics'][0] === eventTopicHash)
              args = exchangeIface.parseLog(log).args
            })
            
            it('should have buyer address as `buyer` field', async () => {  
              expect(args.buyer).to.be.eql(userAddress)
            })
    
            it('should have recipient address as `recipient` field', async () => {  
              expect(args.recipient).to.be.eql(userAddress)
            })

            it('should have tokensSoldIds as `tokensSoldIds` field', async () => {
              for (let i = 0; i < types.length; i++) {
                expect(args.tokensSoldIds[i]).to.be.eql(types[i])
              }
            })

            it('should have tokensSoldAmounts as `tokensSoldAmounts` field', async () => {  
              for (let i = 0; i < types.length; i++) {
                expect(args.tokensSoldAmounts[i]).to.be.eql(tokensAmountsToSell[i])
              }
            })

            it('should have currencyBoughtAmounts as `currencyBoughtAmounts` field', async () => {  
              const costPer = (cost.add(extraFee)).div(types.length)
              for (let i = 0; i < types.length; i++) {
                expect(args.currencyBoughtAmounts[i]).to.be.eql(costPer)
              }
            })

            it('should have extraFeeRecipients as `extraFeeRecipients` field', async () => {  
              for (let i = 0; i < types.length; i++) {
                expect(args.extraFeeRecipients[i]).to.be.eql(extraFeeRecipients[i])
              }
            })

            it('should have extraFeeAmounts as `extraFeeAmounts` field', async () => {  
              for (let i = 0; i < types.length; i++) {
                expect(args.extraFeeAmounts[i]).to.be.eql(extraFeeArray[i])
              }
            })
          })

          describe('Royalties Fees', () => {

            it('Royalty amount should be correct', async () => {
              const royalties = await niftyswapExchangeContract.functions.getRoyalties(randomAddress)
              expect(royalties[0]).to.be.eql(expectedRoyalty)  
              // Ignore extra fee
              expect(royalties[0]).to.be.eql(preRoyaltyCost.mul(nTokenTypes).sub(cost.add(extraFee)))
            })

            it('Should allow royalty recipient to withdraw', async () => {
              const tx = niftyswapExchangeContract.functions.sendRoyalties(randomAddress)
              await expect(tx).to.be.fulfilled
            })

            it('Should allow anyone to send royalties to royalty recipient', async () => {
              let tx = userExchangeContract.functions.sendRoyalties(randomAddress)
              await expect(tx).to.be.fulfilled
            })
            
            context('when sendRoyalties() is successful', () => {
              let preWithdrawExchangeBalance
              beforeEach(async function() {
                preWithdrawExchangeBalance = (await ownerCurrencyContract.functions.balanceOf(userExchangeContract.address))[0] 
                await userExchangeContract.functions.sendRoyalties(randomAddress)
              })

              it('Should update royalty recipient balance', async () => {
                const balance = (await ownerCurrencyContract.functions.balanceOf(randomAddress))[0]
                expect(balance).to.be.eql(expectedRoyalty)
              })

              it('Should update exchange balance', async () => {
                const balance = (await ownerCurrencyContract.functions.balanceOf(userExchangeContract.address))[0]
                expect(balance).to.be.eql(preWithdrawExchangeBalance.sub(expectedRoyalty))
              })

              it('Should set claimable royalty to 0', async () => {
                const royalty = await userExchangeContract.functions.getRoyalties(randomAddress)
                await expect(royalty[0]).to.be.eql(BigNumber.from(0))
              })
            })
          })

          describe('Extra Fees', () => {
            it('Extra amount should be correct', async () => {
              const royalties = await niftyswapExchangeContract.functions.getRoyalties(extraFeeRecipient)
              expect(royalties[0]).to.be.eql(extraFee)  
            })

            it('Should allow royalty recipient to withdraw', async () => {
              const tx = niftyswapExchangeContract.functions.sendRoyalties(extraFeeRecipient)
              await expect(tx).to.be.fulfilled
            })

            it('Should allow anyone to send royalties to royalty recipient', async () => {
              let tx = userExchangeContract.functions.sendRoyalties(extraFeeRecipient)
              await expect(tx).to.be.fulfilled
            })
            
            context('when sendRoyalties() is successful', () => {
              let preWithdrawExchangeBalance
              beforeEach(async function() {
                preWithdrawExchangeBalance = (await ownerCurrencyContract.functions.balanceOf(userExchangeContract.address))[0] 
                await userExchangeContract.functions.sendRoyalties(extraFeeRecipient)
              })

              it('Should update royalty recipient balance', async () => {
                const balance = (await ownerCurrencyContract.functions.balanceOf(extraFeeRecipient))[0]
                expect(balance).to.be.eql(extraFee)
              })

              it('Should update exchange balance', async () => {
                const balance = (await ownerCurrencyContract.functions.balanceOf(userExchangeContract.address))[0]
                expect(balance).to.be.eql(preWithdrawExchangeBalance.sub(extraFee))
              })

              it('Should set claimable royalty to 0', async () => {
                const royalty = await userExchangeContract.functions.getRoyalties(extraFeeRecipient)
                await expect(royalty[0]).to.be.eql(BigNumber.from(0))
              })
            })
          })

        })
      })

      describe('_currencyToToken() function', () => {
        //Buy
        const tokenAmountToBuy = BigNumber.from(50)
        const tokensAmountsToBuy: BigNumber[] = new Array(nTokenTypes).fill('').map((a, i) => tokenAmountToBuy)
        let cost: BigNumber
        let expectedRoyalty: BigNumber
        let preRoyaltyCost: BigNumber

        beforeEach(async () => {
          // Add liquidity
          await operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            types,
            tokenAmountsToAdd,
            addLiquidityData,
            { gasLimit: 30000000 }
          )

          // Sell
          const allcosts = (await niftyswapExchangeContract.functions.getPrice_currencyToToken(types, tokensAmountsToBuy))
          cost = allcosts[0].reduce((acc: BigNumber, a: BigNumber) => acc.add(a)).add(extraFee)

          // Expected royalty 
          const tokenReserve = (await ownerERC1155Contract.balanceOf(niftyswapExchangeContract.address, 0))
          const currencyReserve = (await niftyswapExchangeContract.functions.getCurrencyReserves([0]))[0][0]
          preRoyaltyCost = (await niftyswapExchangeContract.functions.getBuyPrice(tokenAmountToBuy, currencyReserve, tokenReserve))[0]
          expectedRoyalty = preRoyaltyCost.mul(royaltyFee).div(10000).mul(nTokenTypes)
        })

        it('should fail if currency balance is insufficient', async () => {
          await userCurrencyContract.functions.transfer(ownerAddress, currencyAmount)
          const tx = userExchangeContract.functions.buyTokens(
            types,
            tokensAmountsToBuy,
            cost,
            deadline,
            niftyswapExchangeContract.address,
            extraFeeRecipients,
            extraFeeArray,
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.rejectedWith(RevertError('TransferHelper::transferFrom: transferFrom failed'))
        })

        it('should fail if deadline is passed', async () => {
          let timestamp = Math.floor(Date.now() / 1000) - 1
          const tx = userExchangeContract.functions.buyTokens(
            types,
            tokensAmountsToBuy,
            cost,
            timestamp,
            niftyswapExchangeContract.address,
            extraFeeRecipients,
            extraFeeArray,
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.rejectedWith(RevertError('NE20#19'))
        })

        it('should fail if any duplicate', async () => {
          let One = BigNumber.from(1)

          // Tokens to buy
          const tx1 = userExchangeContract.functions.buyTokens(
            [1, 1],
            [One, One],
            cost,
            deadline,
            randomWallet.address,
            extraFeeRecipients,
            extraFeeArray,
            { gasLimit: 8000000 }
          )
          await expect(tx1).to.be.rejectedWith(
            RevertError('NE20#32')
          )

          // Tokens to buy
          const tx2 = userExchangeContract.functions.buyTokens(
            [1, 2, 2],
            [One, One, One],
            cost,
            deadline,
            niftyswapExchangeContract.address,
            extraFeeRecipients,
            extraFeeArray,
            { gasLimit: 8000000 }
          )
          await expect(tx2).to.be.rejectedWith(
            RevertError('NE20#32')
          )

          // Tokens to buy
          const tx3 = userExchangeContract.functions.buyTokens(
            [1, 2, 1],
            [One, One, One],
            cost,
            deadline,
            niftyswapExchangeContract.address,
            extraFeeRecipients,
            extraFeeArray,
            { gasLimit: 8000000 }
          )
          await expect(tx3).to.be.rejectedWith(
            RevertError('NE20#32')
          )
        })

        it('should REVERT if arrays are not the same length', async () => {
          const tx1 = userExchangeContract.functions.buyTokens(
            [0, 1],
            [tokenAmountToBuy],
            cost,
            deadline,
            niftyswapExchangeContract.address,
            extraFeeRecipients,
            extraFeeArray,
            { gasLimit: 8000000 }
          )
          await expect(tx1).to.be.rejectedWith(OpCodeError())

          const tx2 = userExchangeContract.functions.buyTokens(
            [0],
            [tokenAmountToBuy, tokenAmountToBuy],
            cost,
            deadline,
            niftyswapExchangeContract.address,
            extraFeeRecipients,
            extraFeeArray,
            { gasLimit: 8000000 }
          )
          await expect(tx2).to.be.rejectedWith(
            RevertError(erc1155_error_prefix + '_safeBatchTransferFrom: INVALID_ARRAYS_LENGTH')
          )
        })

        it('should buy tokens if currency amount is sufficient', async () => {
          const tx = userExchangeContract.functions.buyTokens(
            types,
            tokensAmountsToBuy,
            cost,
            deadline,
            userAddress,
            extraFeeRecipients,
            extraFeeArray,
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.fulfilled
        })

        it('should REVERT if not sending enough for the extra fee', async () => {
          const tx = userExchangeContract.functions.buyTokens(
            types,
            tokensAmountsToBuy,
            cost.sub(extraFee),
            deadline,
            userAddress,
            [extraFeeRecipient],
            [BigNumber.from(1)],
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.rejectedWith(RevertError("SafeMath#sub: UNDERFLOW"))
        })

        describe('When trade is successful', async () => {
          let tx; 

          beforeEach(async () => {
            tx = await userExchangeContract.functions.buyTokens(
              types,
              tokensAmountsToBuy,
              cost,
              deadline,
              userAddress,
              extraFeeRecipients,
              extraFeeArray,
              { gasLimit: 8000000 }
            )
          })

          it('should update Tokens balances if it passes', async () => {
            for (let i = 0; i < types.length; i++) {
              const exchangeBalance = await userERC1155Contract.functions.balanceOf(niftyswapExchangeContract.address, types[i])
              const userBalance = await userERC1155Contract.functions.balanceOf(userAddress, types[i])

              expect(exchangeBalance[0]).to.be.eql(tokenAmountToAdd.sub(tokenAmountToBuy))
              expect(userBalance[0]).to.be.eql(BigNumber.from(nTokensPerType).add(tokenAmountToBuy))
            }
          })

          it('should update currency balances if it passes', async () => {
            const exchangeBalance = await userCurrencyContract.functions.balanceOf(niftyswapExchangeContract.address)
            const userBalance = await userCurrencyContract.functions.balanceOf(userAddress)

            expect(exchangeBalance[0]).to.be.eql(currencyAmountToAdd.mul(nTokenTypes).add(cost))
            expect(userBalance[0]).to.be.eql(currencyAmount.sub(cost))
          })

          it('should update the currency per token reserve', async () => {
            const reserves = await niftyswapExchangeContract.functions.getCurrencyReserves(types)
            for (let i = 0; i < types.length; i++) {
              expect(reserves[0][i]).to.be.eql(currencyAmountToAdd.add((cost.sub(expectedRoyalty).sub(extraFee)).div(nTokenTypes)))
            }
          })

          it('should have token buy price adjusted', async () => {
            const newCost = (await niftyswapExchangeContract.functions.getPrice_currencyToToken([0], [tokenAmountToBuy]))[0]

            let currencyReserve = currencyAmountToAdd.add((cost.sub(expectedRoyalty).sub(extraFee)).div(nTokenTypes))
            let tokenReserve = tokenAmountToAdd.sub(tokenAmountToBuy)

            let numerator = currencyReserve.mul(tokenAmountToBuy).mul(1000)
            let denominator = tokenReserve.sub(tokenAmountToBuy).mul(LP_FEE_MULTIPLIER)
            const newPreRoyaltyCost = numerator.div(denominator).add(1)
            const newRoyalty = (newPreRoyaltyCost.mul(royaltyFee)).div(10000)

            expect(newCost[0]).to.be.eql(newPreRoyaltyCost.add(newRoyalty))
          })

          it('should emit TokensPurchase event', async () => {
            let filterFromOperatorContract: ethers.ethers.EventFilter

            // Get event filter to get internal tx event
            filterFromOperatorContract = niftyswapExchangeContract.filters.TokensPurchase(null, null, null, null, null, null, null)

            // Get logs from internal transaction event
            // @ts-ignore (https://github.com/ethers-io/ethers.js/issues/204#issuecomment-427059031)
            filterFromOperatorContract.fromBlock = 0
            let logs = await operatorProvider.getLogs(filterFromOperatorContract)
            expect(logs[0].topics[0]).to.be.eql(
              niftyswapExchangeContract.interface.getEventTopic(
                niftyswapExchangeContract.interface.events['TokensPurchase(address,address,uint256[],uint256[],uint256[],address[],uint256[])']
              )
            )
          })

          describe('TokensPurchase Event', () => {
            let args;

            beforeEach(async () => {
              const eventTopicHash = niftyswapExchangeContract.interface.getEventTopic(
                niftyswapExchangeContract.interface.events['TokensPurchase(address,address,uint256[],uint256[],uint256[],address[],uint256[])']
              )
              const receipt = await tx.wait(1)
              const log = receipt.logs.find(a => a['topics'][0] === eventTopicHash)
              args = exchangeIface.parseLog(log).args
            })
            
            it('should have buyer address as `buyer` field', async () => {  
              expect(args.buyer).to.be.eql(userAddress)
            })
    
            it('should have recipient address as `recipient` field', async () => {  
              expect(args.recipient).to.be.eql(userAddress)
            })

            it('should have tokensBoughtIds as `tokensBoughtIds` field', async () => {
              for (let i = 0; i < types.length; i++) {
                expect(args.tokensBoughtIds[i]).to.be.eql(types[i])
              }
            })

            it('should have tokensBoughtAmounts as `tokensBoughtAmounts` field', async () => {  
              for (let i = 0; i < types.length; i++) {
                expect(args.tokensBoughtAmounts[i]).to.be.eql(tokensAmountsToBuy[i])
              }
            })

            it('should have currencySoldAmounts as `currencySoldAmounts` field', async () => {  
              const costPer = (cost.sub(extraFee)).div(types.length)
              for (let i = 0; i < types.length; i++) {
                expect(args.currencySoldAmounts[i]).to.be.eql(costPer)
              }
            })

            it('should have extraFeeRecipients as `extraFeeRecipients` field', async () => {  
              for (let i = 0; i < types.length; i++) {
                expect(args.extraFeeRecipients[i]).to.be.eql(extraFeeRecipients[i])
              }
            })

            it('should have extraFeeAmounts as `extraFeeAmounts` field', async () => {  
              for (let i = 0; i < types.length; i++) {
                expect(args.extraFeeAmounts[i]).to.be.eql(extraFeeArray[i])
              }
            })
          })

          describe('Royalties Fees', () => {
            it('Royalty amount should be correct', async () => {
              const royalties = await niftyswapExchangeContract.functions.getRoyalties(randomAddress)
              expect(royalties[0]).to.be.eql(expectedRoyalty)  
              expect(royalties[0]).to.be.eql(cost.sub(preRoyaltyCost.mul(nTokenTypes)).sub(extraFee))
            })

            it('Should allow royalty recipient to withdraw', async () => {
              const tx = niftyswapExchangeContract.functions.sendRoyalties(randomAddress)
              await expect(tx).to.be.fulfilled
            })

            it('Should allow anyone to send royalties to royalty recipient', async () => {
              let tx = userExchangeContract.functions.sendRoyalties(randomAddress)
              await expect(tx).to.be.fulfilled
            })
            
            context('when sendRoyalties() is successful', () => {
              let preWithdrawExchangeBalance
              beforeEach(async function() {
                preWithdrawExchangeBalance = (await ownerCurrencyContract.functions.balanceOf(userExchangeContract.address))[0] 
                await userExchangeContract.functions.sendRoyalties(randomAddress)
              })

              it('Should update royalty recipient balance', async () => {
                const balance = (await ownerCurrencyContract.functions.balanceOf(randomAddress))[0]
                expect(balance).to.be.eql(expectedRoyalty)
              })

              it('Should update exchange balance', async () => {
                const balance = (await ownerCurrencyContract.functions.balanceOf(userExchangeContract.address))[0]
                expect(balance).to.be.eql(preWithdrawExchangeBalance.sub(expectedRoyalty))
              })

              it('Should set claimable royalty to 0', async () => {
                const royalty = await userExchangeContract.functions.getRoyalties(randomAddress)
                await expect(royalty[0]).to.be.eql(BigNumber.from(0))
              })
            })
          })

          describe('Extra Fees', () => {
            it('Extra amount should be correct', async () => {
              const royalties = await niftyswapExchangeContract.functions.getRoyalties(extraFeeRecipient)
              expect(royalties[0]).to.be.eql(extraFee)  
            })

            it('Should allow royalty recipient to withdraw', async () => {
              const tx = niftyswapExchangeContract.functions.sendRoyalties(extraFeeRecipient)
              await expect(tx).to.be.fulfilled
            })

            it('Should allow anyone to send royalties to royalty recipient', async () => {
              let tx = userExchangeContract.functions.sendRoyalties(extraFeeRecipient)
              await expect(tx).to.be.fulfilled
            })
            
            context('when sendRoyalties() is successful', () => {
              let preWithdrawExchangeBalance
              beforeEach(async function() {
                preWithdrawExchangeBalance = (await ownerCurrencyContract.functions.balanceOf(userExchangeContract.address))[0] 
                await userExchangeContract.functions.sendRoyalties(extraFeeRecipient)
              })

              it('Should update royalty recipient balance', async () => {
                const balance = (await ownerCurrencyContract.functions.balanceOf(extraFeeRecipient))[0]
                expect(balance).to.be.eql(extraFee)
              })

              it('Should update exchange balance', async () => {
                const balance = (await ownerCurrencyContract.functions.balanceOf(userExchangeContract.address))[0]
                expect(balance).to.be.eql(preWithdrawExchangeBalance.sub(extraFee))
              })

              it('Should set claimable royalty to 0', async () => {
                const royalty = await userExchangeContract.functions.getRoyalties(extraFeeRecipient)
                await expect(royalty[0]).to.be.eql(BigNumber.from(0))
              })
            })
          })
        })

        it('should send to non msg.sender if specified', async () => {
          cost = (await niftyswapExchangeContract.functions.getPrice_currencyToToken([0], [tokenAmountToBuy]))[0][0]
          cost = cost.mul(nTokenTypes).add(extraFee)
          const tx = userExchangeContract.functions.buyTokens(
            types,
            tokensAmountsToBuy,
            cost,
            deadline,
            randomWallet.address,
            extraFeeRecipients,
            extraFeeArray,
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.fulfilled

          // Token bought by sender
          for (let i = 0; i < types.length; i++) {
            const exchangeBalance = await userERC1155Contract.functions.balanceOf(niftyswapExchangeContract.address, types[i])
            const randomBalance = await userERC1155Contract.functions.balanceOf(randomWallet.address, types[i])
            const userBalance = await userERC1155Contract.functions.balanceOf(userAddress, types[i])

            expect(exchangeBalance[0]).to.be.eql(tokenAmountToAdd.sub(tokenAmountToBuy))
            expect(randomBalance[0]).to.be.eql(tokenAmountToBuy)
            expect(userBalance[0]).to.be.eql(BigNumber.from(nTokensPerType))
          }

          const exchangeCurrencyBalance = await userCurrencyContract.functions.balanceOf(
            niftyswapExchangeContract.address,
          )
          const randomCurrencyBalance = await userCurrencyContract.functions.balanceOf(randomWallet.address)
          const userCurrencyBalance = await userCurrencyContract.functions.balanceOf(userAddress)

          expect(exchangeCurrencyBalance[0]).to.be.eql(currencyAmountToAdd.mul(nTokenTypes).add(cost))
          expect(randomCurrencyBalance[0]).to.be.eql(ethers.constants.Zero)
          expect(userCurrencyBalance[0]).to.be.eql(currencyAmount.sub(cost))
        })

        it('should send to msg.sender if 0x0 is specified as recipient', async () => {
          cost = (await niftyswapExchangeContract.functions.getPrice_currencyToToken([0], [tokenAmountToBuy]))[0][0]
          cost = cost.mul(nTokenTypes).add(extraFee)
          const tx = userExchangeContract.functions.buyTokens(
            types,
            tokensAmountsToBuy,
            cost,
            deadline,
            ZERO_ADDRESS,
            extraFeeRecipients,
            extraFeeArray,
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.fulfilled

          // Token sold from sender
          for (let i = 0; i < types.length; i++) {
            const exchangeBalance = await userERC1155Contract.functions.balanceOf(niftyswapExchangeContract.address, types[i])
            const userBalance = await userERC1155Contract.functions.balanceOf(userAddress, types[i])

            expect(exchangeBalance[0]).to.be.eql(tokenAmountToAdd.sub(tokenAmountToBuy))
            expect(userBalance[0]).to.be.eql(BigNumber.from(nTokensPerType).add(tokenAmountToBuy))
          }

          const exchangeCurrencyBalance = await userCurrencyContract.functions.balanceOf(
            niftyswapExchangeContract.address,
          )
          const userCurrencyBalance = await userCurrencyContract.functions.balanceOf(userAddress)

          expect(exchangeCurrencyBalance[0]).to.be.eql(currencyAmountToAdd.mul(nTokenTypes).add(cost))
          expect(userCurrencyBalance[0]).to.be.eql(currencyAmount.sub(cost))
        })
      })

      describe('ERC-2981 Token', () => {       
        // Only run for ERC-2981 tokens
        before(async function() {
          if (!(condition[1] == 3 || condition[1] == 4)) {
            this.test!.parent!.pending = true
            this.skip()
          }
        })

        it('Exchange royalty fee should be 0', async () => {
          const fee = (await niftyswapExchangeContract.functions.getGlobalRoyaltyFee())[0]
          expect(fee).to.be.eql(BigNumber.from(0))
        })

        it('Exchange royalty fee recipient should be 0x0', async () => {
          const recipient = (await niftyswapExchangeContract.functions.getGlobalRoyaltyRecipient())[0]
          expect(recipient).to.be.eql(ethers.constants.AddressZero)
        })

        it('Admin should not be able to set fee', async () => {
          const tx = niftyswapExchangeContract.functions.setRoyaltyInfo(royaltyFee, ownerAddress, { gasLimit: 8000000 })
          await expect(tx).to.be.rejectedWith(RevertError('NE20#30'))
        })

        it('Royalty should be capped at 25%', async () => {
          await (ownerERC1155Contract as ERC1155RoyaltyMock).functions.set666FeeRecipient(ethers.Wallet.createRandom().address)
          await (ownerERC1155Contract as ERC1155RoyaltyMock).functions.set666Fee(3000)
          expect((await niftyswapExchangeContract.functions.getRoyaltyInfo(666, 100))[1]).to.be.eql(BigNumber.from(25))
        })

        context('When token IDs dont have the same royalty info', async () => {
          const tokenAmountToBuy = BigNumber.from(10)
          const tokenAmountToAdd = BigNumber.from(50)
          const idsTobuy: number[] = [666, 777, 888]
          const tokensAmountsToMint: BigNumber[] = new Array(idsTobuy.length).fill('').map((a, i) => tokenAmountToBuy.add(tokenAmountToAdd))
          const tokensAmountsToAdd: BigNumber[] = new Array(idsTobuy.length).fill('').map((a, i) => tokenAmountToAdd)
          const tokensAmountsToBuy: BigNumber[] = new Array(idsTobuy.length).fill('').map((a, i) => tokenAmountToBuy)

          const recipient1 = ethers.Wallet.createRandom().address
          const recipient666 = ethers.Wallet.createRandom().address

          const royaltyFee = 200
          const royaltyFee666 = 1000
          
          let expectedRoyalty: BigNumber
          let expectedRoyalty666: BigNumber
          let cost
          
          beforeEach(async () => {
            await ownerERC1155Contract.functions.batchMintMock(operatorAddress, idsTobuy, tokensAmountsToMint, [])
            await ownerERC1155Contract.functions.batchMintMock(userAddress, idsTobuy, tokensAmountsToMint, [])

            const addLiquidityData: string = getAddLiquidityData([currencyAmountToAdd, currencyAmountToAdd, currencyAmountToAdd], deadline)

            // Add liquidity 
            await operatorERC1155Contract.functions.safeBatchTransferFrom(
              operatorAddress,
              niftyswapExchangeContract.address,
              idsTobuy,
              tokensAmountsToAdd,
              addLiquidityData,
              { gasLimit: 30000000 }
            )

            // Set royalties to 2% and 10% for ID 666
            await (ownerERC1155Contract as ERC1155RoyaltyMock).functions.setFee(royaltyFee)
            await (ownerERC1155Contract as ERC1155RoyaltyMock).functions.setFeeRecipient(recipient1)
            await (ownerERC1155Contract as ERC1155RoyaltyMock).functions.set666Fee(royaltyFee666)
            await (ownerERC1155Contract as ERC1155RoyaltyMock).functions.set666FeeRecipient(recipient666)

            // Calculate expected royalties
            const token_reserve = (await ownerERC1155Contract.balanceOf(niftyswapExchangeContract.address, idsTobuy[0]))
            const currency_reserve = (await niftyswapExchangeContract.functions.getCurrencyReserves([idsTobuy[0]]))[0][0]
            const preRoyaltyCost = (await niftyswapExchangeContract.functions.getBuyPrice(tokenAmountToBuy, currency_reserve, token_reserve))[0]

            expectedRoyalty = preRoyaltyCost.mul(royaltyFee).div(10000).mul(2)
            expectedRoyalty666 = preRoyaltyCost.mul(royaltyFee666).div(10000)
            
            // Calculate cost
            const allcosts = (await niftyswapExchangeContract.functions.getPrice_currencyToToken(idsTobuy, tokensAmountsToBuy))
            cost = allcosts[0].reduce((acc: BigNumber, a: BigNumber) => acc.add(a)).add(extraFee)

            // Buy tokens
            await userExchangeContract.functions.buyTokens(
              idsTobuy,
              tokensAmountsToBuy,
              cost,
              deadline,
              userAddress,
              extraFeeRecipients,
              extraFeeArray,
              { gasLimit: 8000000 }
            )
          })

          it('Royalty amount for first recipient should be correct', async () => {
            const royalties = await niftyswapExchangeContract.functions.getRoyalties(recipient1)
            expect(royalties[0]).to.be.eql(expectedRoyalty)  
          })

          it('Royalty amount for 2nd recipient should be correct', async () => {
            const royalties666 = await niftyswapExchangeContract.functions.getRoyalties(recipient666)
            expect(royalties666[0]).to.be.eql(expectedRoyalty666)  

            const royalties = await niftyswapExchangeContract.functions.getRoyalties(recipient1)
            expect(royalties[0].div(2)).to.be.eql(royalties666[0].div(royaltyFee666 / royaltyFee))  
          })
                    
          context('when sendRoyalties() is successful', () => {
            let preWithdrawExchangeBalance
            beforeEach(async function() {
              preWithdrawExchangeBalance = (await ownerCurrencyContract.functions.balanceOf(userExchangeContract.address))[0] 
              await userExchangeContract.functions.sendRoyalties(recipient1)
              await userExchangeContract.functions.sendRoyalties(recipient666)
            })

            it('Should update royalty recipient balance', async () => {
              const balance1 = (await ownerCurrencyContract.functions.balanceOf(recipient1))[0]
              const balance666 = (await ownerCurrencyContract.functions.balanceOf(recipient666))[0]
              expect(balance1).to.be.eql(expectedRoyalty)
              expect(balance666).to.be.eql(expectedRoyalty666)
            })

            it('Should update exchange balance', async () => {
              const balance = (await ownerCurrencyContract.functions.balanceOf(userExchangeContract.address))[0]
              expect(balance).to.be.eql(preWithdrawExchangeBalance.sub(expectedRoyalty).sub(expectedRoyalty666))
            })

            it('Should set claimable royalty to 0', async () => {
              const royalty = await userExchangeContract.functions.getRoyalties(recipient1)
              const royalty666 = await userExchangeContract.functions.getRoyalties(recipient666)
              await expect(royalty[0]).to.be.eql(BigNumber.from(0))
              await expect(royalty666[0]).to.be.eql(BigNumber.from(0))
            })
          })
        })
      })

      describe('Edge cases', () => {
        it('Pool can not go to zero token in reserve', async () => {
          const minBaseCurrency = BigNumber.from(10**3)
          const currencyAmountsToAdd: BigNumber[] = new Array(nTokenTypes).fill('').map((a, i) => minBaseCurrency)
          const tokenAmountsToAdd: BigNumber[] = new Array(nTokenTypes).fill('').map((a, i) => BigNumber.from(1))
          const addLiquidityData: string = getAddLiquidityData(currencyAmountsToAdd, deadline)

          // Add 1000:1 for all pools
          await operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            types,
            tokenAmountsToAdd,
            addLiquidityData,
            { gasLimit: 50000000 }
          )

          // Trying to buy the only tokn will fail as it will cause a division by 0
          let tx = niftyswapExchangeContract.functions.getPrice_currencyToToken([types[0]], [1])
          await expect(tx).to.be.rejectedWith(OpCodeError())
        })

        it('Pool stuck at 1 token can go back up to normal with loss', async () => {
          const initialBaseCurrency = BigNumber.from(10 ** 9)
          const currencyAmountsToAdd: BigNumber[] = new Array(nTokenTypes).fill('').map((a, i) => initialBaseCurrency)
          const tokenAmountsToAdd: BigNumber[] = new Array(nTokenTypes).fill('').map((a, i) => BigNumber.from(1))
          const addLiquidityData: string = getAddLiquidityData(currencyAmountsToAdd, deadline)

          // Add 1000:1 for all pools
          let tx = operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            types,
            tokenAmountsToAdd,
            addLiquidityData,
            { gasLimit: 50000000 }
          )
          await expect(tx).to.be.fulfilled

          // Correct price should be 10**18 currency per token, not 10**9
          // To correct for this, we will add small amount of liquidity and correct the price
          // then withdraw liquidity.

          // To bring the price to around 10**18, we need to add at least sqrt(10**9)-1 tokens (~31622), ignoring fee
          // to liquidity pool then sell but 1 token. This will will give us a price of ~ 10**18 per 1 token,
          // which is the desired price for users to start selling the assets or add liquidity.

          // Add 31622 tokens to pool
          let maxBaseCurrency_1 = BigNumber.from(10).pow(18)
          let currencyAmountsToAdd_1 = new Array(nTokenTypes).fill('').map((a, i) => maxBaseCurrency_1)
          const tokenAmountsToAdd_1 = new Array(nTokenTypes).fill('').map((a, i) => BigNumber.from(31622))
          const addLiquidityData_1 = getAddLiquidityData(currencyAmountsToAdd_1, deadline)
          tx = operatorERC1155Contract.functions.safeBatchTransferFrom(
            operatorAddress,
            niftyswapExchangeContract.address,
            types,
            tokenAmountsToAdd_1,
            addLiquidityData_1,
            { gasLimit: 50000000 }
          )
          await expect(tx).to.be.fulfilled

          // Buy 31622 tokens, to leave a ratio of 10**18 : 1, testing with 1 pool
          let amount_to_buy = BigNumber.from(31622)
          let cost = (await niftyswapExchangeContract.functions.getPrice_currencyToToken([types[0]], [amount_to_buy]))[0][0].add(extraFee)
          
          // Expected royalty 
          const token_reserve = (await ownerERC1155Contract.balanceOf(niftyswapExchangeContract.address, types[0]))
          const currency_reserve = (await niftyswapExchangeContract.functions.getCurrencyReserves([types[0]]))[0][0]
          const preRoyaltyCost = (await niftyswapExchangeContract.functions.getBuyPrice(amount_to_buy, currency_reserve, token_reserve))[0]
          const expectedRoyalty = preRoyaltyCost.mul(royaltyFee).div(10000)

          // Perform the puirchase
          tx = userExchangeContract.functions.buyTokens(
            [types[0]],
            [amount_to_buy],
            cost,
            deadline,
            userAddress,
            extraFeeRecipients,
            extraFeeArray,
            { gasLimit: 8000000 }
          )
          await expect(tx).to.be.fulfilled

          const new_token_reserve = (await ownerERC1155Contract.balanceOf(niftyswapExchangeContract.address, types[0]))
          const new_currency_reserve = (await niftyswapExchangeContract.functions.getCurrencyReserves([types[0]]))[0][0]

          // Pool should have more than 10**18 currency and 1 token
          let expected_price = cost.add(amount_to_buy.add(1).mul(BigNumber.from(10).pow(9)))
          expect(new_token_reserve).to.be.eql(BigNumber.from(1))
          expect(new_currency_reserve).to.be.eql(expected_price.sub(expectedRoyalty).sub(extraFee))
        })
      })
    })
  })
})
