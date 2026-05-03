# Zendvo

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16.x-black?style=for-the-badge&logo=next.js" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue?style=for-the-badge&logo=typescript" alt="TS 5" />
  <img src="https://img.shields.io/badge/Drizzle-ORM-teal?style=for-the-badge&logo=drizzle" alt="Drizzle" />
  <img src="https://img.shields.io/badge/Stellar-Soroban-black?style=for-the-badge&logo=stellar" alt="Stellar" />
</p>

**Zendvo** is a full-stack gifting platform that transforms digital money transfers into memorable experiences. It enables users to send cash gifts that remain completely hidden and locked until a predetermined date and time, powered by Stellar Soroban smart contracts.

## Features

- **Decentralized Time-Locking**: Funds are securely locked in Soroban smart contracts and only unlockable after the specified time.
- **Stablecoin Preservation**: Utilizes USDC to ensure the gift's value remains stable from creation to reveal.
- **Bank Integration**: Seamless on/off-ramps connecting global stablecoin liquidity with local financial systems.
- **Surprise Experience**: High-end UI/UX designed to build anticipation and mystery around digital gifts.
- **Low-Cost Global Transfers**: Leveraging Stellar's high speed and near-zero fees for efficient gifting.

## Stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router)
- **Language**: [TypeScript 5](https://www.typescriptlang.org/)
- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team/)
- **Smart Contracts**: Stellar Soroban (Rust)
- **Styling**: Vanilla CSS & Tailwind CSS 4
- **Integrations**: Stellar SDK, Stripe, Paystack

## Quick Start

1. **Clone and Prepare**:

   ```bash
   git clone https://github.com/codeze-us/zendvo.git
   cd zendvo
   cp .env.example .env
   ```

2. **Install Dependencies**:

   ```bash
   npm install
   ```

3. **Database Setup**:

   ```bash
   npm run db:push
   ```

4. **Run in Development**:

   ```bash
   npm run dev
   ```

## Project Structure

```
src/
├── app/                  # Next.js App Router (Pages & API)
├── server/               # Backend Business Logic & Services
├── components/           # Modular UI Component Library
├── lib/                  # Blockchain & Payment Integrations
├── types/                # Global TypeScript Definitions
└── styles/               # Design System & Styling
```

## Documentation

Comprehensive documentation for Zendvo:

- [Documentation Index](./docs/README.md)
- [Architecture Overview](./docs/architecture/overview.md)
- [Project Vision](./docs/context/project-overview.md)
- [Smart Contract Logic](./docs/blockchain/contracts.md)

## Use Cases

### Surprise Birthdays

Send a cash gift weeks in advance that only unlocks at exactly 12:00 AM on the recipient's birthday, creating a perfect digital surprise.

### Graduation Gifts

Support a student's future by locking funds until their graduation date, ensuring the gift is used for the intended celebration.

### Cross-Border Gifting

Send stablecoins from anywhere in the world to Nigerian recipients with local bank payout support and time-locked reveal logic.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/codeze-us/zendvo/issues)
- **Website**: [www.zendvo.com](https://www.zendvo.com)

## Maintainers

<table align="center">
  <tr>
    <td align="center">
      <img src="https://github.com/codeze-us.png" alt="codeZe-us" width="150" />
      <br /><br />
      <strong>codeZe-us</strong>
      <br /><br />
      <a href="https://github.com/codeze-us" target="_blank">GitHub</a>
    </td>
  </tr>
</table>

---

## Thanks to all the contributors who have made this project possible!

---

<p align="center">
  <i>Decentralizing the art of surprise on Stellar</i>
</p>

---
