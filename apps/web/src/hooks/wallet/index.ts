/**
 * Wallet hooks barrel — the live coin balance + ledger for the economy
 * features and (once wired) the header pill.
 *
 * Integrator: to make the header `CoinBalance` live, swap its static
 * `balance={0}` for `useCoinBalance()` (this is a client hook; the header is
 * already a client component).
 */
export {
  useWallet,
  useCoinBalance,
  useTransactions,
  flattenTransactions,
  useEconomyInvalidation,
} from './use-wallet';
