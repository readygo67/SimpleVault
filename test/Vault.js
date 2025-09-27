const {
    time,
    loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");

describe("Vault", function () {
    let usdt, vault, vusdt;
    let owner, user1, user2;
    let interestRate;
    const big18 = BigInt(10) ** BigInt(18);
    const big16 = BigInt(10) ** BigInt(16);
    const big14 = BigInt(10) ** BigInt(14);
    const big12 = BigInt(10) ** BigInt(12);
    const big6  = BigInt(10) ** BigInt(6);
    const initFund = BigInt(10) ** BigInt(18); //1e^12 usdt

    // We define a fixture to reuse the same setup in every test.
    // We use loadFixture to run this setup once, snapshot that state,
    // and reset Hardhat Network to that snapshot in every test.
    async function deployContracts() {
        // Contracts are deployed using the first signer/account by default
        [owner, user1, user2] = await ethers.getSigners();
        interestRate = big14; //复利，

        const USDT = await ethers.getContractFactory("USDT");
        usdt = await USDT.deploy();
        await usdt.waitForDeployment();

        const Vault = await ethers.getContractFactory("VaultV1");
        vault = await Vault.deploy();
        await vault.waitForDeployment();
        await vault.initialize(await usdt.getAddress(), interestRate);

        //fund vault, make sure enough underlying asset for yielding
        await usdt.mint(await vault.getAddress(), 1000n * initFund)

        //fund 2 users
        await usdt.mint(owner.address, initFund);
        await usdt.mint(user1.address, initFund)

        await usdt.approve(await vault.getAddress(), initFund);
        await usdt.connect(user1).approve(await vault.getAddress(), initFund);
    }

    beforeEach(async function (){
        await loadFixture(deployContracts);
    });

    describe("Deployment", function () {
        it("deploy contracts ", async function () {
            expect(await usdt.name()).to.equal("USDT");
            expect(await usdt.decimals()).to.equal(6);

            //TODO,
            expect(await vault.name()).to.equal("vUSDT");
            expect(await vault.decimals()).to.equal(18);
            expect(await vault.underlyingToken()).to.equal(await usdt.getAddress());
            expect(await vault.interestPerBlock()).to.equal(interestRate);
            expect(await vault.initialExchangeMultiplier()).to.equal(big12);
        });
    });

    describe("initial shares calculation", function() {
        it("should give amount * 1e12 shares on first deposit", async function () {
            expect(await vault.convertToShares(1)).to.equal(big12);
            expect(await vault.convertToShares(100)).to.equal(100n * big12);

            expect(await vault.convertToAssets(big12)).to.equal(1);
            expect(await vault.convertToAssets(100n * big12)).to.equal(100);
        });
    });

    describe("Deposit", function () {
        it("should mint shares on first deposit", async function () {
            const depositAmount = BigInt(1000) * big6; // 1000 USDT

            await expect(vault.connect(user1).deposit(depositAmount))
                .to.emit(vault, "Deposit");

            const balance = await vault.balanceOf(user1.address);
            // shares = amount * initialExchangeMultiplier = amount * 1e12
            const expectedShares = depositAmount * big12;
            expect(balance).to.equal(expectedShares);
        });

        it("should mint proportional shares on later deposits", async function () {
            const d1 = BigInt(1000) * big6;
            const d2 = BigInt(2000) * big6;

            await vault.connect(user1).deposit(d1);
            const shares1 = await vault.balanceOf(user1.address);

            await vault.deposit(d2);
            const shares2 = await vault.balanceOf(owner.address);
            // console.log("share1", shares1);
            // console.log("share2", shares2);

            expect(shares2).to.be.closeTo(shares1 * 2n, shares1 / 1000n); //
        });

        it("shares affected by interest calculation", async function () {
            const d1 = BigInt(1000) * big6;
            const d2 = BigInt(2000) * big6;

            await vault.connect(user1).deposit(d1);
            const shares1 = await vault.balanceOf(user1.address);

            //advance 1w block
            await network.provider.send("hardhat_mine", ["0x2710"]);

            await vault.deposit(d2);
            const shares2 = await vault.balanceOf(owner.address);
            // console.log("share1", shares1);
            // console.log("share2", shares2);
            expect(shares2).to.be.closeTo(shares1 * 1n, shares1 / 1000n); //
        });
    });

    describe("Withdraw", function () {
        it("withdraw immediately", async function () {
            const depositAmount = BigInt(1000) * big6;

            await vault.connect(user1).deposit(depositAmount);
            const shares = await vault.balanceOf(user1.address);

            await expect(vault.connect(user1).withdraw(shares))
                .to.emit(vault, "Withdraw");

            const usdtBalance = await usdt.balanceOf(user1.address);
            expect(usdtBalance).to.be.closeTo(initFund, initFund/100n); //

            let totalSupply = await vault.totalSupply();
            expect(totalSupply).to.equal(0n);

            let vUSDTBalance = await vault.balanceOf(user1.address);
            expect(vUSDTBalance).to.equal(0n);

            let remainedUnderlyingAsset = await vault.totalUnderlyingAssetNow()
            expect(remainedUnderlyingAsset).to.be.closeTo(0n, 1000n); //
        });


        it("withdraw later", async function () {
            const depositAmount = BigInt(1000) * big6;

            await vault.connect(user1).deposit(depositAmount);
            const shares = await vault.balanceOf(user1.address);

            //advance 1w block
            await network.provider.send("hardhat_mine", ["0x2710"]);

            await expect(vault.connect(user1).withdraw(shares))
                .to.emit(vault, "Withdraw");

            const usdtBalance = await usdt.balanceOf(user1.address);
            expect(usdtBalance).to.be.closeTo(initFund + depositAmount, initFund/100n); //

            let totalSupply = await vault.totalSupply();
            expect(totalSupply).to.equal(0n);

            let vUSDTBalance = await vault.balanceOf(user1.address);
            expect(vUSDTBalance).to.equal(0n);

            let remainedUnderlyingAsset = await vault.totalUnderlyingAssetNow()
            expect(remainedUnderlyingAsset).to.be.closeTo(0n, 1000n); //
        });
    });

    describe("multi-user deposit + interest distribution", function () {
        it("fairly distributes interest among multiple users 1 ", async function () {
            const d1 = BigInt(1000) * big6;
            const d2 = BigInt(3000) * big6;

            // user1 deposit 1000 USDT
            await vault.connect(user1).deposit(d1);
            const shares1 = await vault.balanceOf(user1.address);

            // owner deposit 3000 USDT
            await vault.deposit(d2);
            const shares2 = await vault.balanceOf(owner.address);

            //initial shares check
            expect(shares1 * 3n).to.be.closeTo(shares2, shares2/1000n);

            //advance 200 block
            await network.provider.send("hardhat_mine", ["0xc8"]); // 200 blocks

            // withdraw
            const bal1Before = await usdt.balanceOf(user1.address);
            const bal2Before = await usdt.balanceOf(owner.address);

            await vault.connect(user1).withdraw(shares1);
            await vault.withdraw(shares2);

            const bal1After = await usdt.balanceOf(user1.address);
            const bal2After = await usdt.balanceOf(owner.address);

            const gain1 = bal1After - bal1Before; //
            const gain2 = bal2After - bal2Before; //

            // check gain
            expect(gain1 * 3n).to.be.closeTo(gain2, gain2 / 1000n);
        });


        it("fairly distributes interest among multiple users 2", async function () {
            const d1 = BigInt(1000) * big6;
            const d2 = BigInt(3000) * big6;

            // user1 deposit 1000 USDT
            await vault.connect(user1).deposit(d1);
            let shares1 = await vault.balanceOf(user1.address);

            // owner deposit 3000 USDT
            await vault.deposit(d2);
            let shares2 = await vault.balanceOf(owner.address);

            //initial shares check
            expect(shares1 * 3n).to.be.closeTo(shares2, shares2/1000n);

            //advance 200 block
            await network.provider.send("hardhat_mine", ["0xc8"]); // 200 blocks
            //owner withdraw 1/3 share
            await vault.withdraw(shares2 / 3n); //

            shares1 = await vault.balanceOf(user1.address);
            shares2 = await vault.balanceOf(owner.address);
            expect(shares1 *2n).to.be.closeTo(shares2, shares2/1000n);


            //advance another 200 block
            await network.provider.send("hardhat_mine", ["0xc8"]); // 200 blocks

            // withdraw
            const bal1Before = await usdt.balanceOf(user1.address);
            const bal2Before = await usdt.balanceOf(owner.address);

            await vault.connect(user1).withdraw(shares1);
            await vault.withdraw(shares2);

            const bal1After = await usdt.balanceOf(user1.address);
            const bal2After = await usdt.balanceOf(owner.address);

            const gain1 = bal1After - bal1Before; //
            const gain2 = bal2After - bal2Before; //

            // check gain
            expect(gain1 * 2n).to.be.closeTo(gain2, gain2 / 1000n);
        });
    });


    describe("Interest Accrual", function () {
        it("should accrue interest over blocks", async function () {
            const depositAmount = BigInt(1000) * big6;
            await vault.connect(user1).deposit(depositAmount);

            const before = await vault.totalUnderlyingAssetNow();

            //advance 1w block
            await network.provider.send("hardhat_mine", ["0x2710"]);

            let after = await vault.totalUnderlyingAssetNow();
            expect(after).to.be.closeTo(2n * before, depositAmount/1000n); //accure interest

            //advance another 1w block
            await network.provider.send("hardhat_mine", ["0x2710"]);

            after = await vault.totalUnderlyingAssetNow();
            expect(after).to.be.closeTo(3n * before, depositAmount/1000n); //accure interest

        });
    });

    describe("Admin functions", function () {
        it("only owner can set interest rate", async function () {
            await expect(vault.connect(user1).setInterestRate(big18))
                .to.be.revertedWith("only owner");

            await expect(vault.setInterestRate(big18))
                .to.emit(vault, "PerBlockRateUpdated");
        });

        it("owner can transfer ownership", async function () {
            await vault.setOwner(user1.address);
            expect(await vault.owner()).to.equal(user1.address);
        });
    });

    describe("change implementation", function () {
        //TODO(测试proxy 合约)
        it("change implementation", async function(){
            [owner, user] = await ethers.getSigners();

            // 部署 V1
            const VaultV1 = await ethers.getContractFactory("VaultV1");
            let vaultV1 = await VaultV1.deploy();
            await vaultV1.waitForDeployment();

            const initializeData = VaultV1.interface.encodeFunctionData(
                "initialize",
                [await usdt.getAddress(), interestRate]
            );
            console.log("initialize() encoded data:", initializeData);

            const Proxy = await ethers.getContractFactory("SimpleProxy");
            let proxy = await Proxy.deploy(await vaultV1.getAddress(), initializeData);
            await proxy.waitForDeployment();

            let proxyV1 = VaultV1.attach(await proxy.getAddress());

            await proxyV1.setInterestRate(100);
            expect(await proxyV1.interestPerBlock()).to.equal(100);

            // deploy V2
            VaultV2 = await ethers.getContractFactory("VaultV2");
            const vaultV2 = await VaultV2.deploy();
            await vaultV2.waitForDeployment();

            await proxy.upgradeTo(await vaultV2.getAddress());
            let proxyV2 = vaultV2.attach(await proxy.getAddress());
            expect(await proxyV2.interestPerBlock()).to.equal(100);

            expect(await  proxyV2.paused()).to.equal(false);
            await proxyV2.setPaused(true);
            expect(await  proxyV2.paused()).to.equal(true);
        });
    });

});