/*
  Warnings:

  - You are about to drop the `aptos_account` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."aptos_account" DROP CONSTRAINT "aptos_account_walletId_fkey";

-- DropTable
DROP TABLE "public"."aptos_account";

-- CreateTable
CREATE TABLE "rate_limits" (
    "deviceId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("deviceId")
);
