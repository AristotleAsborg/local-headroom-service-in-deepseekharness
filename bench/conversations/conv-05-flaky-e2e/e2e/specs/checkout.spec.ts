import { test, expect } from '@playwright/test'
import { CheckoutPage } from '../pages/checkout'

test.describe('checkout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/checkout')
  })

  test('submits order variant 0', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01000" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 5000 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 1', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01001" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 5100 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 2', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01002" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 5200 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 3', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01003" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 5300 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 4', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01004" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 5400 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 5', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01005" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 5500 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 6', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01006" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 5600 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 7', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01007" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 5700 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 8', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01008" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 5800 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 9', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01009" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 5900 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 10', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01010" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 6000 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 11', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01011" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 6100 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 12', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01012" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 6200 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 13', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01013" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 6300 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 14', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01014" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 6400 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 15', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01015" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 6500 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 16', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01016" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 6600 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 17', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01017" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 6700 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 18', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01018" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 6800 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 19', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01019" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 6900 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 20', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01020" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 7000 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 21', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01021" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 7100 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 22', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01022" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 7200 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 23', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01023" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 7300 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 24', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01024" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 7400 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 25', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01025" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 7500 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 26', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01026" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 7600 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 27', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01027" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 7700 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 28', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01028" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 7800 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 29', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01029" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 7900 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 30', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01030" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 8000 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 31', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01031" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 8100 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 32', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01032" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 8200 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 33', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01033" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 8300 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 34', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01034" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 8400 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 35', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01035" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 8500 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 36', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01036" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 8600 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

  test('submits order variant 37', async ({ page }) => {
    const checkout = new CheckoutPage(page)
    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "01037" })
    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })
    await expect(checkout.payButton).toBeEnabled({ timeout: 8700 })
    await checkout.payButton.click()
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
    await expect(page.getByTestId("order-id")).toContainText("ord_")
  })

})